# Aseguradoras — Persistencia políglota (MongoDB + Neo4j)

Este repositorio contiene un pequeño backend (Node.js + Express) que usa MongoDB como fuente de datos y Neo4j para proyecciones de grafo. También se incluyen scripts para importar datos CSV y una serie de endpoints analíticos.

## Requisitos
- Docker y Docker Compose
- Node.js (para ejecutar tests locales desde `backend/` si hace falta)

## Servicios y puertos
- API: http://localhost:3000
- MongoDB: mongodb://localhost:27017 (base `aseguradoras`)
- Mongo Express (UI): http://localhost:8081
- Neo4j Browser: http://localhost:7474 (bolt: 7687)

## Levantamiento rápido
Desde la raíz del proyecto ejecuta:

```powershell
make up
```

Esto construye y arranca los contenedores: `mongo`, `mongo-express`, `neo4j` y `api`.

Para ver logs:

```powershell
make logs
```

Para parar y eliminar contenedores (sin volúmenes):

```powershell
make stop
```

Para reiniciar por completo (elimina volúmenes asociados):

```powershell
make reset
```

## Importar datos CSV (seed)
Los CSV están en `./data`. El `docker-compose.yml` monta esos archivos en
`/data/import` dentro del contenedor de Mongo (montaje de solo lectura), por lo que la forma recomendada de importar es usar el target del `Makefile`:

```powershell
make import-csv
```

Notas importantes:
- Si ya se ejecutaron importaciones previas, `mongoimport` puede fallar con
  errores E11000 (duplicate key) porque hay índices únicos creados (por
  ejemplo `patente` o la combinación `id_cliente + nro_poliza`). Si se quiere reimportar desde cero se deben eliminar los volúmenes con `make reset` antes de ejecutar `make import-csv`.

## Inicializar/seed Neo4j (ETL)
Después de tener Mongo con los datos, puedes ejecutar la tarea de ETL que
proyecta documentos a nodos/relaciones en Neo4j:

```powershell
make etl-neo4j
# o desde el contenedor api
docker compose exec -T api node src/jobs/etl_mongo_to_neo4j.js
```

## Ejecutar pruebas de integración (local)
El backend incluye un pequeño runner de pruebas de integración que consulta los endpoints expuestos y detecta problemas típicos (forma, paginación y duplicados).

1. Entrar al directorio `backend` e instalar dependencias:

```powershell
cd backend
npm install
```

2. Ejecutar el runner:

```powershell
npm run test:integration
```

El runner (`src/tests/run-all.js`) hace requests a `http://localhost:3000` por defecto. Si tu API está en otra URL define `BASE_URL`.

## Documentación de la API (Swagger UI)

La API incluye documentación OpenAPI expuesta con Swagger UI.

- UI interactiva: `http://localhost:3000/docs`


## Endpoints principales
- GET /health — health check básico
- GET /neo4j/health — verifica conectividad a Neo4j
- POST /polizas — crear póliza (escribe en Mongo y proyecta a Neo4j si es posible)
- POST /siniestros — crear siniestro (dual-write Mongo → Neo4j)

Analíticas (ejemplos):
- GET /vehiculos/asegurados
- GET /clientes/sin-polizas-activas
- GET /agentes/activos-con-cant-polizas
- GET /polizas/vencidas-con-cliente
- GET /clientes/top-cobertura
- GET /siniestros/accidente-ultimo-anio  (usa Neo4j)
- GET /polizas/activas-ordenadas
- GET /polizas/suspendidas-con-estado-cliente
- GET /clientes/con-multiples-vehiculos
- GET /agentes/cant-siniestros  (usa Neo4j)

Explora `backend/src/app.js` para ver detalles de las consultas y parámetros opcionales en cada endpoint.

## Variables de entorno
Se incluye un `.env` de ejemplo en la raíz con las variables usadas por el API:

- MONGO_URI (por defecto: mongodb://mongo:27017/aseguradoras)
- NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
- PORT (por defecto 3000)

Si se ejecuta localmente (fuera de Docker) ajustar `MONGO_URI` y `NEO4J_URI` según el entorno.


## Desarrollo rápido
- Para iterar en el backend es posible reconstruir sólo el servicio API:

```powershell
docker compose up -d --build api
```

- Logs del API:

```powershell
docker compose logs -f api
```

## Limpieza (reimport desde cero)
Si se desea volver a un estado limpio y reimportar CSVs:

```powershell
make reset
make import-csv
make etl-neo4j
```

## Documentación del trabajo

El informe completo de justificación de bases de datos, junto con los esquemas lógico y físico, se encuentra en la carpeta [`docs/`](./docs).  
- 📘 [`INFORME_Bases_Justificacion.md`](./docs/INFORME_Bases_Justificacion.md) — explicación y motivación de las tecnologías utilizadas.  
- 📎 [`Trabajo_Practico_Aseguradoras_2025-2.pdf`](./docs/Trabajo_Practico_Aseguradoras_2025-2.pdf) — consigna original del trabajo práctico.  
- 🖼️ Diagramas en [`docs/imgs/`](./docs/imgs) — esquemas de MongoDB y Neo4j.


## Licencia y contacto
Este proyecto es para fines educativos/prototipo. Para dudas o pedidos de
mejoras abre un issue o contacta al mantenedor del repositorio.
