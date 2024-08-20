import * as fetch from '../src/fetch.js';
import * as getArgs from '../src/args.js';

const getUser = (args) => {
  const prefix = '--user=';
  const arg = args.find(arg => arg.startsWith(prefix));
  if (!arg) {
    throw new Error('--user argument is required.');
  }
  return arg.replace(prefix, '');
};

(async () => {
  const url = getArgs.getUrl(process.argv);
  const user = getUser(process.argv);

  fetch.init(url);

  const userDoc = await fetch.getDoc(`org.couchdb.user:${user}`, '_users');
  console.log(userDoc);
  const params = { contact_id: userDoc.contact_id, facility_id: userDoc.facility_id, role: userDoc.roles };
  const userInfo = await fetch.request({
    method: 'GET',
    url: fetch.getUrl('/api/v1/users-info', params),
  });

  console.log(userInfo);
})();
