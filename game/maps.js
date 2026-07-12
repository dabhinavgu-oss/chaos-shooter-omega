const { dbRun, dbGet, dbAll } = require('../db');

class MapManager {
  constructor() {
    this.activeMaps = {};
  }

  async initializeMaps() {
    const maps = [
      { id: 'map_delta', name: 'Crimson Delta', seed: 12345, mode: 'both' },
      { id: 'map_frost', name: 'Frost Haven', seed: 23456, mode: 'both' },
      { id: 'map_inferno', name: 'Inferno Peaks', seed: 34567, mode: 'both' },
      { id: 'map_void', name: 'Void Canyon', seed: 45678, mode: 'both' },
      { id: 'map_sanctuary', name: 'Sanctuary', seed: 56789, mode: 'both' },
    ];

    for (const map of maps) {
      try {
        await dbRun('INSERT OR IGNORE INTO maps (id, name, seed, mode) VALUES (?, ?, ?, ?)',
          [map.id, map.name, map.seed, map.mode]);
      } catch (err) {
        console.error('Error inserting map:', err);
      }
    }
  }

  async getAllMaps() {
    return await dbAll('SELECT * FROM maps');
  }

  async voteForMap(sessionId, userId, mapId) {
    return await dbRun(
      'INSERT INTO map_votes (session_id, user_id, map_id) VALUES (?, ?, ?)',
      [sessionId, userId, mapId]
    );
  }

  async getWinningMap(sessionId) {
    const votes = await dbAll(
      'SELECT map_id, COUNT(*) as votes FROM map_votes WHERE session_id = ? GROUP BY map_id ORDER BY votes DESC LIMIT 1',
      [sessionId]
    );
    if (votes.length === 0) {
      const maps = await this.getAllMaps();
      return maps[Math.floor(Math.random() * maps.length)];
    }
    return await dbGet('SELECT * FROM maps WHERE id = ?', [votes[0].map_id]);
  }
}

module.exports = { MapManager };