SHELL:=/bin/bash
up:
	docker compose up -d --build
logs:
	docker compose logs -f --tail=200
stop:
	docker compose down
reset:
	docker compose down -v && docker compose up -d --build
