.PHONY: setup verify run clean

setup:
	npm install pg
	docker-compose pull

run:
	docker-compose up -d
	sleep 3 
	node scripts/run_migrations.js
	node scripts/seed_data.js

verify:
	bash scripts/verify_base.sh

clean:
	docker-compose down -v
