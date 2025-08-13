require('dotenv').config();
const crypto = require('crypto');

const secretKey = process.env.SECRET_KEY;



function encrypt(text) {
  const key = Buffer.from(secretKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  const key = Buffer.from(secretKey, 'hex')
  const textParts = text.split(':');
	console.log(456)
  const iv = Buffer.from(textParts.shift(), 'hex');
	console.log(897)
  const encryptedText = Buffer.from(textParts.join(':'), 'hex');
console.log(3455)
	const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

module.exports = {
	encrypt,
	decrypt
}
