/* eslint-disable @typescript-eslint/no-unused-expressions */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import chai from 'chai';
import config from 'config';
import ticketService from '../../src/services/ticketService';
import serviceHelper from '../../src/services/serviceHelper';

const { assert } = chai;

const data = [
  {
    type: 'Incident',
    description: 'Sample Incident',
    subject: 'Sample Incident',
    email: 'sample@incident.com',
  },
  {
    type: 'Question',
    description: 'Sample Question',
    subject: 'Sample Question',
    email: 'sample@question.com',
  },
  {
    type: 'Problem',
    description: 'Sample Problem',
    subject: 'Sample Problem',
    email: 'sample@problem.com',
  },
  {
    type: 'Feature Request',
    description: 'Sample Feature Request',
    subject: 'Sample Feature Request',
    email: 'sample@featurerequest.com',
  },
];

describe('Ticket Service', () => {
  describe('Post Ticket: Correctly verifies ticket creation', () => {
    it('should return success ticket creation for incident', async () => {
      await ticketService.postTicket(data[0]).then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for question', async () => {
        await ticketService.postTicket(data[1]).then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for problem', async () => {
        await ticketService.postTicket(data[2]).then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for feature request', async () => {
        await ticketService.postTicket(data[0]).then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    // Creation of negative test case is limited due to post ticket function error handling
  });
});
