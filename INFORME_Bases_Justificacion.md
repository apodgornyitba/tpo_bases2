# Informe: Justificación de las bases de datos elegidas

## Resumen

Para el sistema de aseguradoras se eligió una arquitectura políglota usando:

- **MongoDB** como base de datos principal (sistema de almacenamiento y consulta de documentos).
- **Neo4j** como base de datos de grafo para proyecciones y consultas relacionales/analíticas.

Esta combinación responde a los requisitos funcionales y no funcionales del enunciado: facilidad para almacenar los registros proporcionados (clientes, pólizas, vehículos, siniestros), operaciones CRUD eficientes, y consultas relacionales complejas (por ejemplo, siniestros relacionados por póliza y sus agentes) donde los grafos aportan consultas más naturales y performantes.

## Requerimientos y motivación

**Requisitos funcionales relevantes**:

- Persistir las entidades relevantes: clientes, agentes, vehículos, pólizas, siniestros.
- CRUD consistente y rápido sobre la fuente de verdad.
- Consultas analíticas y relacionales: top clientes por cobertura, siniestros tipo Accidente en el último año, relaciones cliente–poliza–vehículo–siniestro, conteos por agente.
- Operaciones de carga por lotes (CSV), y endpoints REST para inserción y consulta.
- Proyección a un grafo para casos donde las relaciones y travesías son frecuentes.

**Requisitos no funcionales**:

- Desarrollo rápido y flexible (prototipo/TP).
- Escalabilidad vertical/horizontal razonable.
- Tolerancia a datos semi-estructurados (fechas en distintos formatos, flags, etc).
- Despliegue reproducible (Docker Compose).

## Por qué MongoDB (base primaria)

**Ventajas principales para este dominio**:

1. Modelo de documentos natural:
   - Los objetos (cliente, póliza, siniestro, vehículo) se mapearán directamente a documentos JSON/BSON.
   - Flexibilidad para evoluciones de esquema (p. ej. nuevos campos en pólizas) sin migraciones pesadas.
2. Buen soporte para carga de datos mediante CSV y transformaciones:
   - `mongoimport` y drivers permiten cargar datos rápidamente; la colección actúa como la fuente de la verdad.
3. Consultas y agregaciones potentes:
   - El framework de agregación permite pipelines para unir datos y producir vistas analíticas (utilizado en los endpoints).
4. Índices y rendimiento:
   - Índices compuestos (p. ej. `id_cliente + nro_poliza`) y únicos son fáciles de definir y protegen integridad en ciertos casos.
5. Ecosistema y rapidez de prototipado:
   - Integración nativa con Node.js (driver `mongodb`), amplia documentación.

**Compatibilidad con requisitos**:

- Las operaciones CRUD y búsquedas por campo (dni, nro_poliza, patente) son eficientes con índices.
- El modelo es tolerante a los datos presentados y errores menores en formatos (fechas), con conversión en la capa de la API.

**Limitaciones y mitigaciones**:

- Consultas relacionales complejas con múltiples hops (p. ej. “vecinos a distancia n”) son menos naturales/performantes que en un grafo. Se resuelve proyectando relaciones a Neo4j para esas consultas.
- Garantías ACID a nivel multi-colección no nativas: usar esquema con claves únicas y validaciones, o adoptar transacciones MongoDB (si necesario) para operaciones multi-documento críticas.

## Por qué Neo4j (grafo para proyección)

**Ventajas para este dominio**:

1. Consultas relacionales naturales y eficientes:
   - Búsquedas por patrones (clientes conectados por vehículos, agentes y siniestros) se expresan concisamente en Cypher y suelen ejecutarse muy rápido.
2. Analíticas de red:
   - Topologías, recorridos y filtrados por tipos de relación (p. ej. "siniestros Accidente en el último año") son sencillas.
3. Proyección eventual:
   - Mantener MongoDB como fuente de verdad y proyectar nodos/relaciones permite combinar lo mejor de ambos mundos: integridad y almacenamiento flexible (Mongo) + consultas de grafo rápidas (Neo4j).
4. Constraints y unicidad:
   - Los constraints definidos facilitan mantener identificadores únicos en el grafo (p. ej. id de poliza, id de cliente).

**Caso de uso exacto cubierto**:

- Endpoints que requieren travesías y conteos orientados a relaciones (ej. agente→poliza→siniestro) se resuelven con Cypher o proyecciones específicas.

**Limitaciones y mitigaciones**:

- Sincronización eventual: la proyección puede fallar; el diseño registra errores de sincronización (`_neo4j_sync_error`) y sigue operando desde Mongo.
- Coste operativo: mantener dos sistemas implica duplicar backups, monitoreo y procesos de ETL; se compensa por la mejora en velocidad/respuesta para consultas de grafo.

## Decisiones de modelado

**MongoDB (fuente de verdad)**

- Colecciones y campos (ejemplos):
  - `clientes`: { id_cliente, nombre, apellido, dni, contacto..., activo }
  - `polizas`: { nro_poliza, id_cliente, tipo, fecha_inicio, fecha_fin, prima_mensual, cobertura_total, id_agente, estado }
  - `vehiculos`: { id_vehiculo, id_cliente, marca, modelo, anio, patente, nro_chasis, asegurado }
  - `siniestros`: { id_siniestro, poliza_id (nro_poliza), fecha, tipo, monto_estimado, descripcion, estado }
  - `agentes`: { id_agente, nombre, apellido, matricula, activo, zona }

- Índices:
  - Polizas: { id_cliente }, { id_agente }, { estado }, { fecha_inicio }, { fecha_fin }, índice único compuesto para evitar duplicados lógicos: { id_cliente, nro_poliza }.
  - Vehiculos: índice único sobre `patente`.
  - Siniestros: índices por `poliza_id`, `tipo`, `fecha`.
  - Clientes: índice por `id_cliente` y por `dni` si se requiere búsqueda rápida.

- Normalización vs Denormalización:
  - Se optó por mantener referencias (`id_cliente` en polizas, `poliza_id` en siniestros) en lugar de duplicar datos en cascada. Esto mantiene la fuente de verdad en un sitio y evita inconsistencias.

**Neo4j (grafo proyectado)**

- Nodos: `Cliente`, `Poliza`, `Vehiculo`, `Agente`, `Siniestro`.
- Relaciones:
  - (Cliente)-[:POSEE]->(Vehiculo)
  - (Cliente)-[:CONTRATA]->(Poliza)
  - (Agente)-[:GESTIONA]->(Poliza)
  - (Poliza)-[:TUVO]->(Siniestro)
- Identificadores:
  - Cada nodo tiene propiedad `id` con el id lógico (ej. `id_cliente`, `nro_poliza`, `id_siniestro`) y se definieron constraints de unicidad via `scripts/neo4j/init.cypher`.

## Estrategia ETL / sincronización

- Flujo: los datos se escriben en Mongo (fuente principal). Un job ETL (por lotes o por inserción) proyecta/actualiza nodos y relaciones en Neo4j.
- Dual-write para operaciones en tiempo real: la API primero escribe en Mongo y luego intenta proyectar a Neo4j; en caso de error se marca el documento con un campo de error para reconciliación posterior.
- Lotes: el job `src/jobs/etl_mongo_to_neo4j.js` lee en lotes y ejecuta transacciones en Neo4j para crear/mergear nodos/relaciones de forma eficiente.
- Consistencia: se asume consistencia eventual entre Mongo y Neo4j. Para necesidades de consistencia estricta (p. ej. operación que requiere ambas escrituras atómicas), recomendaría mecanismos transaccionales o un coordinador de compensaciones (saga pattern).

## Índices, rendimiento y escalabilidad

- Mongo:
  - Índices adecuados para filtros y `sort` (fecha_inicio, fecha_fin, estado). Los índices compuestos evitan escaneos completos.
  - Recomendación: vigilar selectividad de índices y cardinalidad; agregar índices de texto solo si se requieren búsquedas por texto.
  - Escalado: escalar lectura/escritura con réplicas y particionado (sharding) si la carga lo exige; diseño actual es suficiente para prototipo y volúmenes modestos.
- Neo4j:
  - Constraints y propiedades indexadas para búsquedas por id.
  - Escalado vertical recomendado para grafos densos; Neo4j Enterprise ofrece clustering para alta disponibilidad si se necesita en producción.

## Alternativas consideradas

1. **HBase**:
   - Desventajas
      - Complejidad operacional innecesaria: HBase requiere un cluster Hadoop completo (HDFS, ZooKeeper, RegionServers), lo cual es excesivo para el volumen de datos a trabajar.
      - Modelo de datos inadecuado: HBase es column-family oriented, diseñado para casos con millones de filas y pocas columnas. Los datos de aseguradoras (clientes, pólizas, siniestros) son más naturalmente documentales con estructuras complejas anidadas.
      - Consultas limitadas: Solo permite queries por row key, sin soporte nativo para consultas secundarias complejas como "siniestros tipo Accidente en el último año por agente" sin implementar índices externos.
      - Overhead vs beneficio: Diseñado para Big Data (petabytes), pero el dominio de aseguradoras maneja volúmenes moderados donde la flexibilidad es más valiosa que la escalabilidad extrema.
   - Ventajas
      - No se encontró ningún motivo que amerite el uso de HBase por sobre MongoDB o Cassandra para alta escritura.
2. **Cassandra**:
   - Desventajas
      - Modelado data-driven inflexible: Cassandra requiere modelar las tablas según las queries específicas (query-first design). Los requisitos del TP incluyen múltiples tipos de consultas analíticas que cambiarían el modelo constantemente.
      - Joins inexistentes: No soporta joins nativos, y las relaciones cliente→póliza→vehículo→siniestro requerirían múltiples roundtrips o denormalización excesiva.
      - Agregaciones limitadas: Las consultas analíticas requeridas (conteos por agente, top clientes por cobertura) son complejas de implementar sin un framework de agregación robusto como el de MongoDB.
      - Eventual consistency por defecto: Para datos financieros/legales como pólizas y siniestros, la consistencia eventual puede ser problemática sin configuración adicional compleja.
   - Ventajas
      - Write throughput masivo sin degradación, replicación multi-datacenter para compliance de respaldo geográfico. Esto ayudaría para auditorías y logging de varias transacciones.
      - Escalabilidad lineal para picos de carga (ej. notificaciones masivas post-catástrofe natural). Si se quisieran agregar notificaciones en tiempo real.
3. **Redis**
   - Desventajas
      - Limitaciones de persistencia: Aunque Redis tiene persistencia, está optimizado como cache/store en memoria. Para datos críticos de aseguradoras se necesita durabilidad garantizada sin riesgo de pérdida.
      - Estructura de datos simplista: Redis maneja estructuras clave-valor, sets, hashes, pero no documentos complejos. Los objetos de aseguradoras (pólizas con coberturas, siniestros con detalles) se benefician del modelo documental.
      - Consultas ad-hoc imposibles: No tiene lenguaje de query para búsquedas complejas. Todo debe ser pre-indexado por clave, lo cual no se adapta a los requisitos analíticos del dominio.
      - Escalabilidad vertical: Redis Cluster es más complejo de administrar que las opciones nativas de sharding de MongoDB.
   - Ventajas
      - Latencia ultra-baja crítica para UX de cotización online, atomic operations para contadores de usage/límites. Para cachear sesiones en caso de querer armar una app o calcular primas en vivo.
      - Procesamiento in-memory permite decisiones instantáneas de aprobación/rechazo de siniestros. Para prevenir fraude en lugar de tener que realizar auditoría caso por caso.

### Conclusión
Si bien las alternativas pueden aportar ventajas, estas se presentan en casos MUY específicos que no sucederán en el contexto de este trabajo ni tiene sentido considerar dado que estos exceden la funcionalidad pedida del sistema. Es por esto que se definió el uso de MongoDB + Neo4j

## Trade-offs y riesgos

- Complejidad operativa mayor (dos DBs) frente a beneficio en rendimiento y modelado.
- Consistencia eventual entre Mongo y Neo4j implica diseñar correctamente la reconciliación y advertir sobre ventanas donde Neo4j y Mongo divergen.
- Para workloads con alto volumen de relaciones dinámicas, mantener la proyección en tiempo real (dual-write) puede exigir robustecer la infraestructura.


