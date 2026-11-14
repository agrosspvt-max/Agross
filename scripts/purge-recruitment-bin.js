'use strict';

// Runs the Recruitment Bin cleanup once, against the database named by DATABASE_URL. The scheduled job
// (api/recruitment-bin-cleanup.js) does this every day; use this to run it by hand, for example to catch up after a
// missed run. It deletes only applications past their 30-day deadline and prints counts, never applicant details.
const { closePool } = require('../lib/db');
const { purgeExpired } = require('../lib/recruitment-bin');

purgeExpired()
    .then(result => console.log('Deleted ' + result.deleted + '. Still overdue: ' + result.overdue + '. In the Bin: ' + result.inBin + '.'))
    .catch(error => { console.error('Cleanup failed:', error.message); process.exitCode = 1; })
    .finally(closePool);
