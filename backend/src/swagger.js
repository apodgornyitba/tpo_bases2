const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Aseguradoras API',
    version: '1.0.0',
    description: 'Documentación OpenAPI de la API Aseguradoras'
  },
  servers: [{ url: process.env.BASE_URL || 'http://localhost:3000' }],
  tags: [
    { name: 'clientes', description: 'Operaciones sobre clientes' },
    { name: 'polizas', description: 'Operaciones sobre pólizas' },
    { name: 'siniestros', description: 'Operaciones sobre siniestros' },
    { name: 'vehiculos', description: 'Operaciones sobre vehículos' },
    { name: 'agentes', description: 'Operaciones sobre agentes' },
    { name: 'infra', description: 'Health / utilidades' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['infra'],
        summary: 'Health check',
        responses: { '200': { description: 'OK' } }
      }
    },
    '/neo4j/health': {
      get: {
        tags: ['infra'],
        summary: 'Health check Neo4j',
        responses: { '200': { description: 'OK' }, '500': { description: 'Error' } }
      }
    },
    '/clientes/activos-con-polizas': {
      get: {
        tags: ['clientes'],
        summary: 'Clientes activos con pólizas vigentes',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } }
        ],
        responses: { '200': { description: 'Listado paginado' } }
      }
    },
    '/siniestros/abiertos': {
      get: {
        tags: ['siniestros'],
        summary: 'Siniestros abiertos (opcional filtro por estado y rango de fechas)',
        parameters: [
          { name: 'estado', in: 'query', schema: { type: 'string' } },
          { name: 'desde', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'hasta', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } }
        ],
        responses: { '200': { description: 'Lista de siniestros' } }
      }
    },
    '/clientes': {
      post: {
        tags: ['clientes'],
        summary: 'Crear cliente',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { id_cliente: { type: 'integer' }, nombre: { type: 'string' }, apellido: { type: 'string' }, email: { type: 'string' } }, required: ['id_cliente','nombre','apellido'] } } } },
        responses: { '201': { description: 'Cliente creado' }, '400': { description: 'Bad request' } }
      }
    },
    '/polizas': {
      post: {
        tags: ['polizas'],
        summary: 'Crear póliza',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nro_poliza: { type: 'string' }, id_cliente: { type: 'integer' }, id_agente: { type: 'integer' }, tipo: { type: 'string' }, fecha_inicio: { type: 'string', format: 'date' }, fecha_fin: { type: 'string', format: 'date' } }, required: ['nro_poliza','id_cliente','id_agente','tipo'] } } } },
        responses: { '201': { description: 'Póliza creada' }, '400': { description: 'Bad request' } }
      }
    },
    '/clientes/{id}/baja': {
      patch: {
        tags: ['clientes'],
        summary: 'Dar de baja cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Baja realizada' }, '404': { description: 'No encontrado' } }
      }
    },
    '/clientes/{id}': {
      patch: {
        tags: ['clientes'],
        summary: 'Modificar cliente (parcial)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { '200': { description: 'Cliente actualizado' }, '400': { description: 'Bad request' } }
      }
    },
    '/siniestros': {
      post: {
        tags: ['siniestros'],
        summary: 'Crear siniestro',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { nro_poliza: { type: 'string' }, tipo: { type: 'string' }, fecha: { type: 'string', format: 'date' }, monto_estimado: { type: 'number' }, descripcion: { type: 'string' } }, required: ['nro_poliza','tipo'] } } } },
        responses: { '201': { description: 'Siniestro creado' }, '400': { description: 'Bad request' } }
      }
    },
    '/vehiculos/asegurados': {
      get: { tags: ['vehiculos'], summary: 'Vehículos asegurados con su cliente y pólizas', responses: { '200': { description: 'Listado' } } }
    },
    '/clientes/sin-polizas-activas': { get: { tags: ['clientes'], summary: 'Clientes sin pólizas activas', responses: { '200': { description: 'Listado' } } } },
    '/agentes/activos-con-cant-polizas': { get: { tags: ['agentes'], summary: 'Agentes activos con cantidad de pólizas', responses: { '200': { description: 'Listado' } } } },
    '/polizas/vencidas-con-cliente': { get: { tags: ['polizas'], summary: 'Pólizas vencidas con datos del cliente', responses: { '200': { description: 'Listado' } } } },
    '/clientes/top-cobertura': { get: { tags: ['clientes'], summary: 'Top 10 clientes por cobertura total', responses: { '200': { description: 'Listado' } } } },
    '/siniestros/accidente-ultimo-anio': { get: { tags: ['siniestros'], summary: 'Siniestros tipo Accidente del último año (Neo4j)', responses: { '200': { description: 'Listado' } } } },
    '/polizas/activas-ordenadas': { get: { tags: ['polizas'], summary: 'Pólizas activas ordenadas por fecha de inicio (paginadas)', parameters: [ { name: 'page', in: 'query', schema: { type: 'integer' } }, { name: 'pageSize', in: 'query', schema: { type: 'integer' } } ], responses: { '200': { description: 'Listado paginado' } } } },
    '/polizas/suspendidas-con-estado-cliente': { get: { tags: ['polizas'], summary: 'Pólizas suspendidas con estado del cliente', responses: { '200': { description: 'Listado' } } } },
    '/clientes/con-multiples-vehiculos': { get: { tags: ['clientes'], summary: 'Clientes con más de un vehículo asegurado', responses: { '200': { description: 'Listado' } } } },
    '/agentes/cant-siniestros': { get: { tags: ['agentes'], summary: 'Agentes y cantidad de siniestros asociados (Neo4j)', responses: { '200': { description: 'Listado' } } } }
  }
};

export default swaggerSpec;
