import fs from 'node:fs';
const {stats}=JSON.parse(fs.readFileSync('test-results/e2e.json','utf8'));
console.log(JSON.stringify({suite:'real-local-Supabase-Next-browser',stats}));
if(stats.expected!==8||stats.skipped!==0||stats.unexpected!==0||stats.flaky!==0) process.exit(1);
