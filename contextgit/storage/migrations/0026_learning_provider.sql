-- Each desktop project owns its repository and its learning connection default.
CREATE TABLE learning_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL
);
