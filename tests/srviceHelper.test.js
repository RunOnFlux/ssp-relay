/* eslint-disable no-unused-expressions */
/* eslint-disable func-names */
const chai = require('chai');
const serviceHelper = require('../src/services/serviceHelper');

const { expect } = chai;

describe('Service helperService: Correctly verifies ZelID', () => {
  it('Missing ZelID is false', () => {
    const isValid = serviceHelper.verifyZelID();
    expect(isValid).to.be.false;
  });
  it('Invalid ZelID is false', () => {
    const isValid = serviceHelper.verifyZelID('34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo');
    expect(isValid).to.be.false;
  });
  it('Valid ZelID is true', () => {
    const isValid = serviceHelper.verifyZelID('1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ');
    expect(isValid).to.be.true;
  });
});

describe('Service helperService: Correctly verifies Public Keys', () => {
  it('Missing Public Key is false', () => {
    const isValid = serviceHelper.verifyPublicKey();
    expect(isValid).to.be.false;
  });
  it('Invalid Public Key is false', () => {
    const isValid = serviceHelper.verifyPublicKey('xxx');
    expect(isValid).to.be.false;
  });
  it('Invalid Public Key is false B', () => {
    const isValid = serviceHelper.verifyPublicKey('618423c1dbed7381cf8cf151702f205a8c3979a76d60b307b03c97bb95474a');
    expect(isValid).to.be.false;
  });
  it('Invalid Public Key is false B', () => {
    const isValid = serviceHelper.verifyPublicKey('618423c1dbed7381cf8cf151702f205a8c3979a76d60b307b03c97bb95474Z');
    expect(isValid).to.be.false;
  });
  it('Valid Public Key is true', () => {
    const isValid = serviceHelper.verifyPublicKey('618423c1dbed7381cf8cf151702f205a8c3979a76d60b307b03c97bb95474a84');
    expect(isValid).to.be.true;
  });
});

describe('Service helperService: Verifies signed messages', () => {
  it('Missing parameter is false', () => {
    const isValid = serviceHelper.verifyMessage('kappa', null, 'echo');
    expect(isValid).to.be.false;
  });
  it('Invalid signature length false', () => {
    const isValid = serviceHelper.verifyMessage('kappa', 'bravo', 'echo');
    expect(isValid).to.be.false;
  });
  it('Invalid addrtess checksum is false', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, 'bravo', 'HyAx+99on7kGgfqn5oCZMS98Hpate1XEduqM1OtJVu7NWFqw7UgvXEiGlXtETm1IJTXJiZltd3zF1H9R3MFCjWg=');
    expect(isValid).to.be.false;
  });
  it('Valid signature is true', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, '1E1NSwDHtvCziYP4CtgiDMcgvgZL64PhkR', 'HyAx+99on7kGgfqn5oCZMS98Hpate1XEduqM1OtJVu7NWFqw7UgvXEiGlXtETm1IJTXJiZltd3zF1H9R3MFCjWg=');
    expect(isValid).to.be.true;
  });
  it('Signature is false for wrong message magic', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, '1E1NSwDHtvCziYP4CtgiDMcgvgZL64PhkR', 'HyAx+99on7kGgfqn5oCZMS98Hpate1XEduqM1OtJVu7NWFqw7UgvXEiGlXtETm1IJTXJiZltd3zF1H9R3MFCjWg=', '00', 'custom str');
    expect(isValid).to.be.false;
  });
  it('Signature on different network is false', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, '1E7utaVa4wFWmrafUvvKRpbNEhFX3JHAkT', 'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0Srg=');
    expect(isValid).to.be.false;
  });
  it('Signature with custom message magic is true', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, '1E7utaVa4wFWmrafUvvKRpbNEhFX3JHAkT', 'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0Srg=', '00', '\u0018Zelcash Signed Message:\n');
    expect(isValid).to.be.true;
  });
  it('Signature on different network with correct message magic is true', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, 't1WzWtuui3G37NVdZRMjSZdhHVMSbmjCZky', 'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0Srg=', '1cbd', '\u0018Zelcash Signed Message:\n');
    expect(isValid).to.be.true;
  });
  it('Signature on different network with correct message magic but invalid sig is false', () => {
    const message = 'Beautiful Message';
    const isValid = serviceHelper.verifyMessage(message, 't1WzWtuui3G37NVdZRMjSZdhHVMSbmjCZky', 'H/lodJkp7ruVp6oK7KkE8ehpgoDiSl51pMUbICShYhfOC6mtnljQwCvwaTokJi14vJjyZEU1EUl5Szt9jDD0SrP=', '1cbd', '\u0018Zelcash Signed Message:\n');
    expect(isValid).to.be.false;
  });
});
