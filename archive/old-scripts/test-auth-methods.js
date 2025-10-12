import { GoogleSpreadsheet } from 'google-spreadsheet';

const doc = new GoogleSpreadsheet('test');
console.log('doc.auth:', doc.auth);
console.log('typeof doc.auth:', typeof doc.auth);
console.log('doc.authMode:', doc.authMode);
console.log('typeof doc.authMode:', typeof doc.authMode);
console.log('doc._setAxiosRequestAuth:', doc._setAxiosRequestAuth);
console.log('typeof doc._setAxiosRequestAuth:', typeof doc._setAxiosRequestAuth);
