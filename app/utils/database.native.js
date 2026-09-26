import * as SQLite from 'expo-sqlite'

import { DATABASE_SCHEMA } from '~/utils/databaseSchema'


const DATABASE_NAME = 'castafiore-catalog-v8.db'

let databasePromise
let databaseWriteQueue = Promise.resolve()
let nextDatabaseWriteId = 1
const pendingDatabaseWrites = new Map()

const DATABASE_LOCK_RETRY_DELAYS = [50, 100, 200, 400]

const wait = delay => new Promise(resolve => setTimeout(resolve, delay))

const isDatabaseLocked = error => /database is (?:locked|busy)/i.test(String(error?.message || error))

const runWithLockRetry = async task => {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await task()
		} catch (error) {
			if (!isDatabaseLocked(error) || attempt >= DATABASE_LOCK_RETRY_DELAYS.length) throw error
			await wait(DATABASE_LOCK_RETRY_DELAYS[attempt])
		}
	}
}

const initializeSchema = async database => {
	await database.execAsync('PRAGMA journal_mode = WAL')
	await database.execAsync('PRAGMA busy_timeout = 5000')
	await database.execAsync(DATABASE_SCHEMA)
}

export const getDatabase = () => {
	if (!databasePromise) {
		databasePromise = SQLite.openDatabaseAsync(DATABASE_NAME)
			.then(async database => {
				await initializeSchema(database)
				return database
			})
	}

	return databasePromise
}

export const initializeDatabase = () => getDatabase()

export const runDatabaseWrite = (nameOrTask, optionalTask = null) => {
	const task = typeof nameOrTask === 'function' ? nameOrTask : optionalTask
	const name = typeof nameOrTask === 'string' ? nameOrTask : 'database-write'
	if (typeof task !== 'function') return Promise.reject(new TypeError('Database write task is required'))
	const id = nextDatabaseWriteId
	nextDatabaseWriteId += 1
	pendingDatabaseWrites.set(id, { id, name, queuedAt: Date.now() })
	const result = databaseWriteQueue.then(async () => {
		const pending = pendingDatabaseWrites.get(id)
		if (pending) pending.startedAt = Date.now()
		return runWithLockRetry(async () => task(await getDatabase()))
	})
		.finally(() => pendingDatabaseWrites.delete(id))
	databaseWriteQueue = result.catch(() => {})
	return result
}

export const getPendingDatabaseWrites = () => [...pendingDatabaseWrites.values()]
