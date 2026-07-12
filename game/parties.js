const { dbRun, dbGet, dbAll } = require('../db');
const { v4: uuidv4 } = require('uuid');

class PartyManager {
  constructor() {
    this.parties = {};
  }

  async createParty(userId, partyName, mode = 'zombies', capacity = 4) {
    const partyId = uuidv4();
    
    await dbRun(
      'INSERT INTO parties (id, creator_id, name, mode, capacity) VALUES (?, ?, ?, ?, ?)',
      [partyId, userId, partyName, mode, capacity]
    );

    await dbRun(
      'INSERT INTO party_members (party_id, user_id, ready) VALUES (?, ?, 1)',
      [partyId, userId]
    );

    this.parties[partyId] = {
      id: partyId,
      creatorId: userId,
      name: partyName,
      mode,
      capacity,
      members: [{ userId, ready: true }],
    };

    return partyId;
  }

  async joinParty(partyId, userId) {
    const party = this.parties[partyId];
    if (!party) return null;

    if (party.members.length >= party.capacity) {
      return { error: 'Party is full' };
    }

    if (party.members.some(m => m.userId === userId)) {
      return { error: 'Already in party' };
    }

    await dbRun(
      'INSERT INTO party_members (party_id, user_id, ready) VALUES (?, ?, 0)',
      [partyId, userId]
    );

    party.members.push({ userId, ready: false });
    return { success: true };
  }

  async leaveParty(partyId, userId) {
    const party = this.parties[partyId];
    if (!party) return;

    party.members = party.members.filter(m => m.userId !== userId);

    await dbRun(
      'DELETE FROM party_members WHERE party_id = ? AND user_id = ?',
      [partyId, userId]
    );

    if (party.members.length === 0) {
      delete this.parties[partyId];
      await dbRun('DELETE FROM parties WHERE id = ?', [partyId]);
    } else if (party.creatorId === userId) {
      const newCreator = party.members[0].userId;
      party.creatorId = newCreator;
      await dbRun('UPDATE parties SET creator_id = ? WHERE id = ?', [newCreator, partyId]);
    }
  }

  async setReady(partyId, userId, ready) {
    const party = this.parties[partyId];
    if (!party) return;

    const member = party.members.find(m => m.userId === userId);
    if (member) member.ready = ready;

    await dbRun(
      'UPDATE party_members SET ready = ? WHERE party_id = ? AND user_id = ?',
      [ready ? 1 : 0, partyId, userId]
    );
  }

  areAllReady(partyId) {
    const party = this.parties[partyId];
    return party && party.members.length > 0 && party.members.every(m => m.ready);
  }

  getParty(partyId) {
    return this.parties[partyId];
  }

  async getPartiesByMode(mode) {
    return Object.values(this.parties).filter(p => p.mode === mode && p.members.length < p.capacity);
  }
}

module.exports = { PartyManager };