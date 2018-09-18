const OrbitDB = require('orbit-db')
const Log = require('ipfs-log')
const Multihash = require('multihashes')
const nacl = require('tweetnacl')

const SALT_KEY = '3BOX_SALT'

class PrivateStore {
  /**
   * Please use **threeBox.privateStore** to get the instance of this class
   */
  constructor (muportDID, ipfs, updateRoot) {
    this.muportDID = muportDID
    this.ipfs = ipfs
    this.updateRoot = updateRoot
  }

  /**
   * Get the value of the given key
   *
   * @param     {String}    key                     the key
   * @return    {String}                            the value associated with the key
   */
  async get (key) {
    if (!this.db) throw new Error('_sync must be called before interacting with the store')

    const encryptedEntry = await this.db.get(this._genDbKey(key))
    return encryptedEntry ? this._decryptEntry(encryptedEntry) : null
  }

  /**
   * Set a value for the given key
   *
   * @param     {String}    key                     the key
   * @param     {String}    value                   the value
   * @return    {Boolean}                           true if successful
   */
  async set (key, value) {
    if (!this.db) throw new Error('_sync must be called before interacting with the store')

    value = this._encryptEntry(value)
    const dbKey = this._genDbKey(key)

    const hash = await this.db.put(dbKey, value)
    return this.updateRoot(hash)
  }

  /**
   * Remove the value for the given key
   *
   * @param     {String}    key                     the key
   * @return    {Boolean}                           true if successful
   */
  async remove (key) {
    if (!this.db) throw new Error('_sync must be called before interacting with the store')

    const dbKey = this._genDbKey(key)
    const hash = await this.db.del(dbKey)
    return this.updateRoot(hash)
  }

  async _sync (hash) {
    if (!this.db) {
      const orbitdb = new OrbitDB(this.ipfs)
      // the db needs a unique name, we use the hash of the DID + a store specific name
      const storeName = sha256(this.muportDID.getDid()) + '.datastore'
      this.db = await orbitdb.keyvalue(storeName, {
        replicate: false,
        write: ['*']
      })
    }
    if (hash) {
      // sync orbitdb to hash
      let log = await Log.fromEntryHash(this.ipfs, hash)

      return new Promise((resolve, reject) => {
        this.db.events.on('replicated', async (address, logLength) => {
          // get the key salt of the db
          const encryptedSalt = await this.db.get(SALT_KEY)
          this.salt = this._decryptEntry(encryptedSalt)
          resolve()
        })
        this.db.sync(log.values)
      })
    }
    // This is the first time the store is used.
    // Generate a random salt and save in the db.
    this.salt = Buffer.from(nacl.randomBytes(16)).toString('hex')
    const encryptedSalt = this._encryptEntry(this.salt)
    await this.db.put(SALT_KEY, encryptedSalt)
  }

  async close () {
    this.db.close()
  }

  _genDbKey (key) {
    return sha256(this.salt + key)
  }

  _encryptEntry (entry) {
    if (typeof entry === 'undefined') throw new Error('Entry to encrypt cannot be undefined')

    return this.muportDID.symEncrypt(JSON.stringify(entry))
  }

  _decryptEntry ({ ciphertext, nonce }) {
    return JSON.parse(this.muportDID.symDecrypt(ciphertext, nonce))
  }
}

const sha256 = str => {
  const dataBuf = Buffer.from(str, 'utf8')
  return Multihash.encode(dataBuf, 'sha2-256').toString('hex')
}

module.exports = PrivateStore
