#!/usr/bin/env node

import * as getArgs from '../src/args.js';
import * as fetch from '../src/fetch.js';
import * as getIds from '../src/get-ids.js';

const url = getArgs.getUrl(process.argv);
fetch.init(url);

const inputPath = getArgs.getInputPath(process.argv);

(async () => {
  const files = await getIds.getFiles(inputPath);
  for (const file of files) {
    const idsToPurge = await getIds.getIdsFromFile(inputPath, file);
    console.log('purging file', file);
    const t = Date.now();
    let docCount = 0;

    for (const [database, uuids] of Object.entries(idsToPurge)) {
      docCount += uuids.length;
      await fetch.purgeDocs(uuids, database);
    }
    console.log(file, Date.now() - t, docCount);
  }
})();
