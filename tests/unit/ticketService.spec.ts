// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck test suite
import { assert } from 'chai';
import ticketService from '../../src/services/ticketService';
import sinon from 'sinon';


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

describe('Ticket Service', function () {
  describe('Post Ticket: Correctly verifies ticket creation', function () {
    afterEach(function () {
      sinon.restore();
    });

    it('should return success ticket creation for incident', async function () {
      await ticketService
        .postTicket(data[0])
        .then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for question', async function () {
      await ticketService
        .postTicket(data[1])
        .then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for problem', async function () {
      await ticketService
        .postTicket(data[2])
        .then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    it('should return success ticket creation for feature request', async function () {
      await ticketService
        .postTicket(data[0])
        .then((r) => assert.equal(r, 'Ticket created successfully.'));
    });

    // Testing using stub data
    it('should return error result if stub value is false', async function () {
      const freshdesk = {
        createTicket: sinon.stub(),
      };
      await freshdesk.createTicket.throws(new Error());
      await ticketService
        .postTicket(141)
        .catch((e) => assert.equal(e, 'Failed to create a Ticket'));
    });

    it('should return successful result if stub value is false', async function () {
      const freshdesk = {
        createTicket: sinon.stub(),
      };
      await freshdesk.createTicket.throws(
        new Error('Cannot read properties of unde'),
      );
      await ticketService
        .postTicket(data[0])
        .then((r) => assert.equal(r, 'Ticket created successfully.'));
    });
  });
});
