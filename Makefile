SHELL:=/bin/bash
up:
	docker compose up -d --build
logs:
	docker compose logs -f --tail=200
stop:
	docker compose down
reset:
	docker compose down -v && docker compose up -d --build
import-csv:
	docker exec -i tpo-mongo-1 mongoimport --db aseguradoras --collection clientes --type csv --headerline --file /data/import/clientes.csv
	docker exec -i tpo-mongo-1 mongoimport --db aseguradoras --collection agentes --type csv --headerline --file /data/import/agentes.csv
	docker exec -i tpo-mongo-1 mongoimport --db aseguradoras --collection polizas --type csv --headerline --file /data/import/polizas.csv
	docker exec -i tpo-mongo-1 mongoimport --db aseguradoras --collection siniestros --type csv --headerline --file /data/import/siniestros.csv
	docker exec -i tpo-mongo-1 mongoimport --db aseguradoras --collection vehiculos --type csv --headerline --file /data/import/vehiculos.csv
etl-neo4j:
	docker compose exec -T api node src/jobs/etl_mongo_to_neo4j.js