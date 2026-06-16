// Simple test setup to mock Firebase
const sinon = require('sinon');

// Create a mock Firebase admin (legacy namespaced + v14 modular sub-paths)
const mockMessaging = {
  send: sinon.stub().resolves(),
  sendEach: sinon
    .stub()
    .resolves({ successCount: 0, failureCount: 0, responses: [] }),
};
const mockFirebaseAdmin = {
  initializeApp: sinon.stub(),
  credential: { cert: sinon.stub().returns({}) },
  messaging: sinon.stub().returns(mockMessaging),
};
const mockFirebaseApp = {
  initializeApp: sinon.stub(),
  cert: sinon.stub().returns({}),
  applicationDefault: sinon.stub().returns({}),
};
const mockFirebaseMessaging = {
  getMessaging: sinon.stub().returns(mockMessaging),
};

// Store original require
const Module = require('module');
const originalRequire = Module.prototype.require;

// Override require to return mock for firebase-admin
Module.prototype.require = function (id) {
  if (id === 'firebase-admin') return mockFirebaseAdmin;
  if (id === 'firebase-admin/app') return mockFirebaseApp;
  if (id === 'firebase-admin/messaging') return mockFirebaseMessaging;
  return originalRequire.apply(this, arguments);
};
