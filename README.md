# Aseguradoras — Persistencia políglota (MongoDB + Neo4j)

## Requisitos
- Docker y Docker Compose

## Levantar
```bash
make up
make seed-neo4j
# opcional: importar CSVs
make import-csv