-- Runs once on first container start. Creates the integration-test database.
CREATE DATABASE zy_commerce_test;
GRANT ALL PRIVILEGES ON DATABASE zy_commerce_test TO zy;
