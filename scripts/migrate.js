'use strict';

// Applies any new files in db/migrations to the database named by DATABASE_URL.
const { migrate, closePool } = require('../lib/db');

migrate()
    .then(ran => console.log(ran.length ? 'Applied: ' + ran.join(', ') : 'Database is up to date.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(closePool);
