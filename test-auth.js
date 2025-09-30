import { GoogleSpreadsheet } from 'google-spreadsheet';

const doc = new GoogleSpreadsheet('test');
console.log('useServiceAccountAuth exists:', typeof doc.useServiceAccountAuth);
console.log('Methods:', Object.getOwnPropertyNames(doc).filter(name => name.includes('auth') || name.includes('Auth')));
console.log('All methods:', Object.getOwnPropertyNames(doc));
