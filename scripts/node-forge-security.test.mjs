import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const clientRequire = createRequire(new URL('../client/package.json', import.meta.url));
const expoRequire = createRequire(clientRequire.resolve('expo/package.json'));
const cliRequire = createRequire(expoRequire.resolve('@expo/cli'));
const signingRequire = createRequire(cliRequire.resolve('@expo/code-signing-certificates'));
const signing = cliRequire('@expo/code-signing-certificates');
const pem = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicExponent: 3,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

// Resolve both real Expo consumers, so a second unpatched copy cannot pass.
for (const [consumer, require] of [['Expo CLI', cliRequire], ['Expo certificates', signingRequire]]) {
  const forge = require('node-forge');
  const { asn1, pki, md } = forge;
  const privateKey = pki.privateKeyFromPem(pem.privateKey);
  const publicKey = pki.publicKeyFromPem(pem.publicKey);
  const digest = md.sha256.create().update('dependency security regression').digest().getBytes();
  const element = (type, value, constructed = false) =>
    asn1.create(asn1.Class.UNIVERSAL, type, constructed, value);

  for (const withNull of [false, true]) {
    test(`${consumer}: rejects extra DigestAlgorithm children (NULL=${withNull})`, () => {
      const algorithm = [element(asn1.Type.OID, asn1.oidToDer(forge.oids.sha256).getBytes())];
      if (withNull) algorithm.push(element(asn1.Type.NULL, ''));
      const digestInfo = element(asn1.Type.SEQUENCE, [
        element(asn1.Type.SEQUENCE, algorithm, true),
        element(asn1.Type.OCTETSTRING, digest),
      ], true);
      // Construct a signed encoding locally to exercise the vulnerable parser,
      // without disabling padding checks or relying on a signature forgery.
      const signature = () => pki.rsa.encrypt(asn1.toDer(digestInfo).getBytes(), privateKey, 0x01);
      assert.equal(publicKey.verify(digest, signature()), true);
      digestInfo.value[0].value.push(element(asn1.Type.OCTETSTRING, 'unconsumed bytes'));
      assert.throws(() => publicKey.verify(digest, signature()), /DigestInfo/);
    });
  }
}

test('Expo certificates and manifest signing remain compatible with native RSA verification', () => {
  const keyPair = signing.convertKeyPairPEMToKeyPair({
    privateKeyPEM: pem.privateKey,
    publicKeyPEM: pem.publicKey,
  });
  const now = Date.now();
  const certificate = signing.generateSelfSignedCodeSigningCertificate({
    keyPair,
    validityNotBefore: new Date(now - 60_000),
    validityNotAfter: new Date(now + 60_000),
    commonName: 'local-security-regression',
  });
  signing.validateSelfSignedCertificate(certificate, keyPair);
  const buffer = Buffer.from('local manifest');
  const signature = signing.signBufferRSASHA256AndVerify(keyPair.privateKey, certificate, buffer);
  assert.equal(verify('sha256', buffer, pem.publicKey, Buffer.from(signature, 'base64')), true);
  assert.equal(signing.generateCSR(keyPair, 'local-security-regression').verify(), true);
});
