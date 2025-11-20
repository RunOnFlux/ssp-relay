// Simple test setup to mock Firebase
const sinon = require('sinon');

// Create a mock Firebase admin
const mockFirebaseAdmin = {
  initializeApp: sinon.stub(),
  credential: {
    cert: sinon.stub().returns({}),
  },
  messaging: sinon.stub().returns({
    send: sinon.stub().resolves(),
  }),
};

// Store original require
const Module = require('module');
const originalRequire = Module.prototype.require;

// Override require to return mock for firebase-admin
Module.prototype.require = function (id) {
  if (id === 'firebase-admin') {
    return mockFirebaseAdmin;
  }
  return originalRequire.apply(this, arguments);
};
