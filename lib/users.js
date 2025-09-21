// lib/users.js

const fs = require('fs')

const path = require('path')

const config = require('../config')

const DB_FILE = path.join(__dirname, '..', 'db.json')

// --- init / load

function loadDB() {

  if (!fs.existsSync(DB_FILE)) {

    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2))

  }

  try {

    const raw = fs.readFileSync(DB_FILE, 'utf8') || '{"users":{}}'

    const db = JSON.parse(raw)

    if (!db.users) db.users = {}

    return db

  } catch {

    return { users: {} }

  }

}

let DB = loadDB()

let _saveTO = null

function saveDB() {

  clearTimeout(_saveTO)

  _saveTO = setTimeout(() => {

    fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2))

  }, 150)

}

// --- helpers

function normalizeJid(jid='') {

  if (!jid) return jid

  return jid.includes('@') ? jid : `${jid}@s.whatsapp.net`

}

function ownerJid() {

  const on = config.ownerNumber || ''

  return normalizeJid(on)

}

// --- core user

function ensureUser(jidRaw) {

  const jid = normalizeJid(jidRaw)

  if (!DB.users[jid]) {

    const presetPremium = (config.premiumNumbers || []).map(normalizeJid)

    const role = (jid === ownerJid()) ? 'owner'

              : (presetPremium.includes(jid) ? 'premium' : 'free')  // free|premium|owner|banned

    const baseLimit = role === 'premium'

      ? Number(config.premiumDefaultLimit || config.defaultLimit || 0)

      : Number(config.defaultLimit || 0)

    DB.users[jid] = {

      registered: false,

      role,

      limit: baseLimit,

      used: 0,

      premiumUntil: null,   // timestamp ms (opsional)

      createdAt: Date.now(),

      updatedAt: Date.now()

    }

    saveDB()

  }

  return DB.users[jid]

}

// --- role checks

function isOwner(jidRaw) {

  return normalizeJid(jidRaw) === ownerJid()

}

function isPremium(jidRaw) {

  const u = ensureUser(jidRaw)

  if (u.role === 'owner') return true

  if (u.role === 'premium') {

    if (!u.premiumUntil) return true

    if (Date.now() <= u.premiumUntil) return true

    // expired -> turunkan ke free

    u.role = 'free'

    u.premiumUntil = null

    saveDB()

    return false

  }

  return false

}

function isFree(jidRaw) {

  const u = ensureUser(jidRaw)

  return u.role === 'free'

}

// --- role mutators

function setRole(jidRaw, role='free') {

  const jid = normalizeJid(jidRaw)

  const u = ensureUser(jid)

  u.role = role

  if (role === 'premium') {

    u.premiumUntil = null

    if (u.limit < (Number(config.premiumDefaultLimit || u.limit))) {

      u.limit = Number(config.premiumDefaultLimit || u.limit)

    }

  }

  if (role === 'owner') {

    // owner unlimited (opsional)

  }

  u.updatedAt = Date.now()

  saveDB()

  return u

}

function setPremium(jidRaw, days=30) {

  const jid = normalizeJid(jidRaw)

  const u = ensureUser(jid)

  const ms = Number(days) * 24 * 60 * 60 * 1000

  u.role = 'premium'

  u.premiumUntil = Date.now() + ms

  // beri limit premium default jika lebih kecil

  const premDef = Number(config.premiumDefaultLimit || config.defaultLimit || 0)

  if (u.limit < premDef) u.limit = premDef

  u.updatedAt = Date.now()

  saveDB()

  return u

}

function revokePremium(jidRaw) {

  const jid = normalizeJid(jidRaw)

  const u = ensureUser(jid)

  u.role = 'free'

  u.premiumUntil = null

  u.updatedAt = Date.now()

  saveDB()

  return u

}

// --- register / limit

function isRegistered(jidRaw) {

  return !!ensureUser(jidRaw).registered

}

function setRegistered(jidRaw, v=true) {

  const u = ensureUser(jidRaw)

  u.registered = !!v

  u.updatedAt = Date.now()

  saveDB()

  return u.registered

}

function setLimit(jidRaw, value) {

  const u = ensureUser(jidRaw)

  u.limit = Math.max(0, Number(value)||0)

  if (u.used > u.limit) u.used = u.limit

  u.updatedAt = Date.now()

  saveDB()

  return { limit: u.limit, used: u.used, remaining: Math.max(0, u.limit - u.used) }

}

function addLimit(jidRaw, add) {

  const u = ensureUser(jidRaw)

  u.limit = Math.max(0, u.limit + (Number(add)||0))

  u.updatedAt = Date.now()

  saveDB()

  return { limit: u.limit, used: u.used, remaining: Math.max(0, u.limit - u.used) }

}

function useLimit(jidRaw, cost=1) {

  const u = ensureUser(jidRaw)

  const remain = u.limit - u.used

  if (remain < cost) return { ok:false, reason:'insufficient', limit:u.limit, used:u.used, remaining:remain }

  u.used += cost

  u.updatedAt = Date.now()

  saveDB()

  return { ok:true, limit:u.limit, used:u.used, remaining: u.limit - u.used }

}

function refundLimit(jidRaw, amount=1) {

  const u = ensureUser(jidRaw)

  u.used = Math.max(0, u.used - (Number(amount)||0))

  u.updatedAt = Date.now()

  saveDB()

  return { limit:u.limit, used:u.used, remaining: u.limit - u.used }

}

function resetDaily(jidRaw) {

  const u = ensureUser(jidRaw)

  u.used = 0

  u.updatedAt = Date.now()

  saveDB()

  return { limit:u.limit, used:u.used, remaining: u.limit }

}

module.exports = {

  // raw db (jarang perlu)

  _DB: () => DB,

  // ensure / get

  ensureUser,

  // roles

  isOwner, isPremium, isFree,

  setRole, setPremium, revokePremium,

  // register

  isRegistered, setRegistered,

  // limit

  setLimit, addLimit, useLimit, refundLimit, resetDaily,

  // util

  normalizeJid, ownerJid, saveDB

}