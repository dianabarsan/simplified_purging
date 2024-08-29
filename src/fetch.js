import fetch from 'node-fetch';

const logWrapper = (caller, level, ...args) => {
  const date = `[${new Date().toISOString()}] ${level.toLocaleUpperCase()}:`;
  caller(date, ...args);
};
['log', 'warn', 'error'].forEach((method) => {
  const original = console[method];
  console[method] = (...args) => logWrapper(original, method, ...args);
});

let serverUrl;
const PURGE_RETRY = 10;
const BATCH_SIZE = 50;
const COLD_STORAGE_DB = 'medic-cold-storage';

export const MEDIC_DB_NAME = 'medic';
const NOT_FOUND_STATUS = 404;

export const init = (url) => {
  serverUrl = url;
  serverUrl.pathname = '/';
};

class HTTPResponseError extends Error {
  constructor(response, responseData) {
    super(`HTTP Error Response: ${response.status} ${response.statusText}`);
    this.response = responseData;
    this.status = response.status;
  }
}

const getResponseData = (response, json) => json ? response.json() : response.text();

const stringifyParam = (key, value) => {
  if (key.startsWith('start') || key.startsWith('end') || key.startsWith('doc_ids') || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return value;
};
export const getUrl = (path, searchParams) => {
  const url = new URL(serverUrl.toString());

  url.pathname = path;

  const params = new URLSearchParams(url.search);
  searchParams && Object.entries(searchParams).forEach(([key, value]) => params.set(key, stringifyParam(key, value)));
  url.search = params.toString();

  url.username = '';
  url.password = '';
  return url.toString();
};

export const request = async ({ url, json = true, ...moreOpts }) => {
  const opts = { ...moreOpts };
  opts.headers = opts.headers || {};
  opts.headers.Authorization =
    `Basic ${Buffer.from(serverUrl.username + ':' + serverUrl.password, 'binary').toString('base64')}`;
  if (json) {
    opts.headers = {
      ...opts.headers,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (opts.body) {
      opts.body = JSON.stringify(opts.body);
    }
  }

  const t = Date.now();
  const response = await fetch(url, opts);
  if (!response.ok) {
    let responseData;
    try {
      responseData = await getResponseData(response, json);
    } catch (err) {
      responseData = response;
    }
    console.log(url, 'error after', Date.now() - t);
    throw new HTTPResponseError(response, responseData);
  }

  return await getResponseData(response, json);
};

export const getDoc = async (uuid, db = MEDIC_DB_NAME, rev) => {
  const searchParams = { attachments: true, rev };
  try {
    return await request({ url: getUrl(`/${db}/${uuid}`, searchParams)  });
  } catch (err) {
    if (err.status === NOT_FOUND_STATUS) {
      return;
    }
    throw err;
  }
};

export const getDocRevs = async (uuids, db) => {
  const url = getUrl(
    `/${db}/_changes`,
    { style: 'all_docs', filter: '_doc_ids', include_docs: 'true', attachments: 'true' }
  );
  const changes = await request({ url, method: 'POST', body: { doc_ids: uuids } });
  const revs = {};
  const docs = {};
  for (const change of changes.results) {
    revs[change.id] = change.changes.map(change => change.rev);
    if (revs[change.id].length > 1) {
      docs[change.id] = await Promise.all(revs[change.id].map(rev => getDoc(change.id, db, rev)));
    } else {
      docs[change.id] = [change.doc];
    }
  }
  return { revs, docs };
};

const backupDocs = async (docs, database) => {
  try {
    // await request({ url: getUrl(`/${COLD_STORAGE_DB}`), method: 'PUT' });
  } catch (err) {
    // this will fail if the database already exists
  }

  const docsToSave = [];
  Object.values(docs).forEach((docs) => {
    docsToSave.push(...docs
      .filter(doc => doc)
      .map(doc => {
        doc._id = `${database}:${doc._id}:${doc._rev}`;
        delete doc._rev;
        return doc;
      })
    );
  });
  await request({
    url: getUrl(`/${COLD_STORAGE_DB}/_bulk_docs`),
    method: 'POST',
    body: { docs: docsToSave },
  });
};

const queryViews = async (database) => {
  if (database !== MEDIC_DB_NAME) {
    return;
  }

  console.log('calling views');

  let url = getUrl(`/${database}/_design/medic/_view/contacts_by_depth`, { limit: 1 });
  await request({ url });
  url = getUrl(`/${database}/_design/medic-client/_view/contacts_by_last_visited`, { limit: 1 });
  await request({ url });
};

export const purgeDocs = async (uuids, database) => {
  while (uuids.length) {
    const batch = uuids.splice(0, BATCH_SIZE);
    console.log('Purging. Uuids left', uuids.length);
    const { revs, docs } = await getDocRevs(batch, database);

    if (!Object.keys(revs).length) {
      continue;
    }

    await backupDocs(docs, database);

    const url = getUrl(`/${database}/_purge`);
    let retry = PURGE_RETRY;
    do {
      try {
        await request({ url, method: 'POST', body: revs });
        retry = false;
      } catch (err) {
        if (!--retry) {
          throw err;
        }
      }
    } while (retry);

    await queryViews(database);
  }
};
