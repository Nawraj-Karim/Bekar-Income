const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- ১. ডাটাবেজ কানেকশন ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://public:public123@cluster0.mongodb.net/telegram_app';
mongoose.connect(MONGO_URI).catch(err => console.log(err.message));

// --- ২. ডাটাবেজ মডেলস ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
  telegramId: { type: String, required: true, unique: true },
  username: { type: String, default: 'Anonymous' },
  points: { type: Number, default: 0 },
  spins: { type: Number, default: 3 },
  referredBy: { type: String, default: null },
  isNewUser: { type: Boolean, default: true },
  savedWallet: { method: { type: String, default: '' }, accountNo: { type: String, default: '' } }
}));

const Task = mongoose.models.Task || mongoose.model('Task', new mongoose.Schema({
  title: String, type: { type: String, enum: ['normal', 'vip'] }, rewardPoints: Number
}));

const TaskSubmission = mongoose.models.TaskSubmission || mongoose.model('TaskSubmission', new mongoose.Schema({
  userId: String, taskId: mongoose.Schema.Types.ObjectId, status: { type: String, default: 'pending' }
}));

const Withdraw = mongoose.models.Withdraw || mongoose.model('Withdraw', new mongoose.Schema({
  userId: String, method: String, accountNo: String, amountBdt: Number, status: { type: String, default: 'pending' }, rejectReason: { type: String, default: '' }
}));

const Commission = mongoose.models.Commission || mongoose.model('Commission', new mongoose.Schema({
  referrerId: String, fromUserId: String, fromUsername: String, taskTitle: String, commissionPoints: Number
}));

// --- ৩. ব্যাকএন্ড এপিআই রাউটস ---
app.post('/api/user/login', async (req, res) => {
  const { telegramId, username, referrerId } = req.body;
  try {
    let user = await User.findOne({ telegramId: String(telegramId) });
    if (!user) {
      user = new User({ telegramId: String(telegramId), username });
      if (referrerId && String(referrerId) !== String(telegramId)) {
        const inviter = await User.findOne({ telegramId: String(referrerId) });
        if (inviter) {
          user.referredBy = String(referrerId);
          inviter.spins += 1; inviter.points += 50; // বোনাস পয়েন্ট
          await inviter.save();
        }
      }
      await user.save();
    }
    res.json({ success: true, user });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/admin/approve-task', async (req, res) => {
  const { submissionId } = req.body;
  try {
    const submission = await TaskSubmission.findById(submissionId);
    if (!submission || submission.status !== 'pending') return res.status(400).json({ success: false });
    submission.status = 'approved'; await submission.save();

    const task = await Task.findById(submission.taskId);
    const user = await User.findOne({ telegramId: submission.userId });
    user.points += task.rewardPoints; await user.save();

    // 🌟 ২০% অটো-কমিশন (VIP টাস্ক)
    if (task.type === 'vip' && user.referredBy) {
      const inviter = await User.findOne({ telegramId: user.referredBy });
      if (inviter) {
        const comm = Math.round(task.rewardPoints * 0.20);
        inviter.points += comm; await inviter.save();
        await Commission.create({ referrerId: user.referredBy, fromUserId: user.telegramId, fromUsername: user.username, taskTitle: task.title, commissionPoints: comm });
      }
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/user/withdraw', async (req, res) => {
  const { telegramId, method, accountNo, amountBdt, saveInfo } = req.body;
  try {
    const user = await User.findOne({ telegramId });
    const pointsNeeded = amountBdt * 100;
    if (user.points < pointsNeeded) return res.status(400).json({ success: false, message: 'Insufficient balance.' });

    user.points -= pointsNeeded;
    if (saveInfo) { user.savedWallet.method = method; user.savedWallet.accountNo = accountNo; }
    await user.save();

    await Withdraw.create({ userId: telegramId, method, accountNo, amountBdt });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/reject-withdraw', async (req, res) => {
  const { withdrawId, reason } = req.body;
  try {
    const withdraw = await Withdraw.findById(withdrawId);
    withdraw.status = 'rejected'; withdraw.rejectReason = reason; await withdraw.save();

    const user = await User.findOne({ telegramId: withdraw.userId });
    if (user) { user.points += (withdraw.amountBdt * 100); await user.save(); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false }); }
});

module.exports = app;
