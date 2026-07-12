const { dbRun, dbGet, dbAll } = require('../db');

class FriendsManager {
  constructor() {
    this.onlineUsers = new Map();
  }

  async sendFriendRequest(fromUserId, toUserId) {
    const existing = await dbGet(
      'SELECT * FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)',
      [fromUserId, toUserId, toUserId, fromUserId]
    );

    if (existing) {
      if (existing.status === 'pending') {
        return { error: 'Request already pending' };
      }
      return { error: 'Already friends' };
    }

    await dbRun(
      'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "pending")',
      [fromUserId, toUserId]
    );

    return { success: true };
  }

  async acceptFriendRequest(fromUserId, toUserId) {
    const friend = await dbGet(
      'SELECT * FROM friends WHERE user_id = ? AND friend_id = ?',
      [fromUserId, toUserId]
    );

    if (!friend) return { error: 'No request found' };

    await dbRun(
      'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?',
      [fromUserId, toUserId]
    );

    const reverse = await dbGet(
      'SELECT * FROM friends WHERE user_id = ? AND friend_id = ?',
      [toUserId, fromUserId]
    );

    if (!reverse) {
      await dbRun(
        'INSERT INTO friends (user_id, friend_id, status) VALUES (?, ?, "accepted")',
        [toUserId, fromUserId]
      );
    } else {
      await dbRun(
        'UPDATE friends SET status = "accepted" WHERE user_id = ? AND friend_id = ?',
        [toUserId, fromUserId]
      );
    }

    return { success: true };
  }

  async getFriends(userId) {
    const friends = await dbAll(
      `SELECT f.friend_id as id, u.username FROM friends f
       JOIN users u ON f.friend_id = u.id
       WHERE f.user_id = ? AND f.status = "accepted"`,
      [userId]
    );

    return friends.map(f => ({
      ...f,
      online: this.isOnline(f.id)
    }));
  }

  async getPendingRequests(userId) {
    return await dbAll(
      `SELECT f.user_id as id, u.username FROM friends f
       JOIN users u ON f.user_id = u.id
       WHERE f.friend_id = ? AND f.status = "pending"`,
      [userId]
    );
  }

  setOnline(userId, socketId) {
    this.onlineUsers.set(userId, socketId);
  }

  setOffline(userId) {
    this.onlineUsers.delete(userId);
  }

  isOnline(userId) {
    return this.onlineUsers.has(userId);
  }

  getSocketId(userId) {
    return this.onlineUsers.get(userId);
  }
}

module.exports = { FriendsManager };