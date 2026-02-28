import { GoogleSpreadsheet } from 'google-spreadsheet';

const doc = new GoogleSpreadsheet('test');
console.log('Available methods:');
console.log(Object.getOwnPropertyNames(doc).filter(name => name.includes('auth') || name.includes('Auth') || name.includes('service') || name.includes('Service')));
console.log('All methods:');
console.log(Object.getOwnPropertyNames(doc));