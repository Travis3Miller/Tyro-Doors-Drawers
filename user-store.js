const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { Pool } = require("pg");

const DEFAULT_FILE = path.join(__dirname, "data", "user-store.json");

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeStatus(value, fallback = "inactive") {
  const safe = typeof value === "string" ? value.trim().toLowerCase() : "";
  return safe || fallback;
}

function normalizePlan(value, fallback = "free") {
  const safe = typeof value === "string" ? value.trim().toLowerCase() : "";
  return safe || fallback;
}

function emptyState() {
  return {
    users: [],
    projects: [],
    presets: []
  };
}

function normalizeState(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    users: Array.isArray(source.users) ? source.users : [],
    projects: Array.isArray(source.projects) ? source.projects : [],
    presets: Array.isArray(source.presets) ? source.presets : []
  };
}

function resolveIdentityMatch(users, identity = {}) {
  const byMember = identity.externalMemberId
    ? users.filter((user) => user.externalMemberId === identity.externalMemberId)
    : [];
  const byCustomer = identity.externalCustomerId
    ? users.filter((user) => user.externalCustomerId === identity.externalCustomerId)
    : [];
  const byEmail = identity.email
    ? users.filter((user) => user.email && user.email.toLowerCase() === identity.email)
    : [];

  if (byMember.length > 1 || byCustomer.length > 1 || byEmail.length > 1) {
    throw new Error("Conflicting identity match.");
  }

  const matches = [byMember[0], byCustomer[0], byEmail[0]].filter(Boolean);
  const uniqueIds = new Set(matches.map((user) => user.id));
  if (uniqueIds.size > 1) {
    throw new Error("Conflicting identity match.");
  }
  return matches[0] || null;
}

function normalizeProjectInput(input = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : null;
  const settings = input.settings && typeof input.settings === "object"
    ? input.settings
    : payload && payload.settings && typeof payload.settings === "object"
      ? payload.settings
      : {};
  const materials = input.materials && typeof input.materials === "object"
    ? input.materials
    : payload && payload.materials && typeof payload.materials === "object"
      ? payload.materials
      : {};
  const selections = input.selections && typeof input.selections === "object"
    ? input.selections
    : payload && payload.selections && typeof payload.selections === "object"
      ? payload.selections
      : payload && typeof payload === "object"
        ? payload
        : {};

  return { settings, materials, selections };
}

function mapProject(record) {
  const settings = record.settings && typeof record.settings === "object" ? record.settings : {};
  const materials = record.materials && typeof record.materials === "object" ? record.materials : {};
  const selections = record.selections && typeof record.selections === "object" ? record.selections : {};
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    settings,
    materials,
    selections,
    payload: selections,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapUser(record) {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    email: record.email || "",
    name: record.name || "",
    plan: normalizePlan(record.plan),
    subscriptionStatus: normalizeStatus(record.subscriptionStatus),
    externalCustomerId: record.externalCustomerId || "",
    externalMemberId: record.externalMemberId || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

class UserStore {
  constructor(options = {}) {
    this.databaseUrl = options.databaseUrl || process.env.DATABASE_URL || "";
    this.filePath = options.filePath || process.env.USER_STORE_FILE || DEFAULT_FILE;
    this.mode = this.databaseUrl ? "postgres" : "file";
    this.pool = null;
    this._fileQueue = Promise.resolve();
  }

  async init() {
    if (this.mode === "postgres") {
      this.pool = new Pool({ connectionString: this.databaseUrl });
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT,
          name TEXT,
          plan TEXT NOT NULL DEFAULT 'free',
          subscription_status TEXT NOT NULL DEFAULT 'inactive',
          external_customer_id TEXT,
          external_member_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          materials JSONB NOT NULL DEFAULT '{}'::jsonb,
          selections JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS presets (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          data JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower_unique
          ON users(LOWER(email))
          WHERE email IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_customer_id_unique
          ON users(external_customer_id)
          WHERE external_customer_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external_member_id_unique
          ON users(external_member_id)
          WHERE external_member_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
        CREATE INDEX IF NOT EXISTS idx_presets_user_id ON presets(user_id);
      `);
      return;
    }

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const normalized = normalizeState(JSON.parse(raw));
      await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2), "utf8");
    } catch (err) {
      if (err && err.code === "ENOENT") {
        await fs.writeFile(this.filePath, JSON.stringify(emptyState(), null, 2), "utf8");
        return;
      }
      throw err;
    }
  }

  async _readFileState() {
    const raw = await fs.readFile(this.filePath, "utf8");
    return normalizeState(JSON.parse(raw));
  }

  async _writeFileState(state) {
    const normalized = normalizeState(state);
    await fs.writeFile(this.filePath, JSON.stringify(normalized, null, 2), "utf8");
  }

  async _withFileLock(operation) {
    const run = this._fileQueue.then(() => operation());
    this._fileQueue = run.catch(() => {});
    return run;
  }

  async _lookupUserByFieldPostgres(db, field, value) {
    if (!value) {
      return null;
    }
    const queryByField = {
      email: {
        sql: `
          SELECT id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
          FROM users
          WHERE LOWER(email) = $1
        `,
        value: String(value).trim().toLowerCase()
      },
      externalCustomerId: {
        sql: `
          SELECT id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
          FROM users
          WHERE external_customer_id = $1
        `,
        value: String(value).trim()
      },
      externalMemberId: {
        sql: `
          SELECT id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
          FROM users
          WHERE external_member_id = $1
        `,
        value: String(value).trim()
      }
    };
    const config = queryByField[field];
    if (!config) {
      return null;
    }
    const result = await db.query(config.sql, [config.value]);
    if (result.rows.length > 1) {
      throw new Error(`Conflicting identity match for ${field}.`);
    }
    return result.rows[0] || null;
  }

  async _findUserByIdentityPostgres(db, identity = {}) {
    const matches = await Promise.all([
      this._lookupUserByFieldPostgres(db, "externalMemberId", identity.externalMemberId),
      this._lookupUserByFieldPostgres(db, "externalCustomerId", identity.externalCustomerId),
      this._lookupUserByFieldPostgres(db, "email", identity.email)
    ]);
    const uniqueIds = new Set(matches.filter(Boolean).map((row) => row.id));
    if (uniqueIds.size > 1) {
      throw new Error("Conflicting identity match.");
    }
    if (!uniqueIds.size) {
      return null;
    }
    return matches.find(Boolean);
  }

  async getUserById(userId) {
    if (!userId) {
      return null;
    }

    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `
          SELECT id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [userId]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return mapUser({
        id: row.id,
        email: row.email,
        name: row.name,
        plan: row.plan,
        subscriptionStatus: row.subscription_status,
        externalCustomerId: row.external_customer_id,
        externalMemberId: row.external_member_id,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : nowIso(),
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : nowIso()
      });
    }

    const state = await this._readFileState();
    return mapUser(state.users.find((user) => user.id === userId) || null);
  }

  async upsertUserFromIdentity(identity = {}) {
    const email = identity.email ? String(identity.email).trim().toLowerCase() : "";
    if (!email) {
      throw new Error("Email is required.");
    }

    const name = identity.name ? String(identity.name).trim() : "";
    const externalCustomerId = identity.externalCustomerId ? String(identity.externalCustomerId).trim() : "";
    const externalMemberId = identity.externalMemberId
      ? String(identity.externalMemberId).trim()
      : identity.memberId
        ? String(identity.memberId).trim()
        : identity.id
          ? String(identity.id).trim()
          : "";

    const requestedPlan = normalizePlan(identity.plan, "free");
    const requestedSubscriptionStatus = normalizeStatus(identity.subscriptionStatus, "inactive");

    if (this.mode === "postgres") {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const client = await this.pool.connect();
        try {
          await client.query("BEGIN");
          const existing = await this._findUserByIdentityPostgres(client, { email, externalCustomerId, externalMemberId });

          if (!existing) {
            const id = newId();
            const inserted = await client.query(
              `
                INSERT INTO users (id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                RETURNING id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
              `,
              [id, email, name, requestedPlan, requestedSubscriptionStatus, externalCustomerId || null, externalMemberId || null]
            );
            await client.query("COMMIT");
            return mapUser({
              id: inserted.rows[0].id,
              email: inserted.rows[0].email,
              name: inserted.rows[0].name,
              plan: inserted.rows[0].plan,
              subscriptionStatus: inserted.rows[0].subscription_status,
              externalCustomerId: inserted.rows[0].external_customer_id,
              externalMemberId: inserted.rows[0].external_member_id,
              createdAt: new Date(inserted.rows[0].created_at).toISOString(),
              updatedAt: new Date(inserted.rows[0].updated_at).toISOString()
            });
          }

          const resolvedExternalCustomerId = existing.external_customer_id || externalCustomerId || null;
          const resolvedExternalMemberId = existing.external_member_id || externalMemberId || null;
          const updated = await client.query(
            `
              UPDATE users
              SET
                email = COALESCE(NULLIF($2, ''), email),
                name = COALESCE(NULLIF($3, ''), name),
                external_customer_id = $4,
                external_member_id = $5,
                updated_at = NOW()
              WHERE id = $1
              RETURNING id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
            `,
            [
              existing.id,
              email,
              name,
              resolvedExternalCustomerId,
              resolvedExternalMemberId
            ]
          );

          await client.query("COMMIT");
          return mapUser({
            id: updated.rows[0].id,
            email: updated.rows[0].email,
            name: updated.rows[0].name,
            plan: updated.rows[0].plan,
            subscriptionStatus: updated.rows[0].subscription_status,
            externalCustomerId: updated.rows[0].external_customer_id,
            externalMemberId: updated.rows[0].external_member_id,
            createdAt: new Date(updated.rows[0].created_at).toISOString(),
            updatedAt: new Date(updated.rows[0].updated_at).toISOString()
          });
        } catch (err) {
          await client.query("ROLLBACK");
          if (err && err.code === "23505" && attempt === 0) {
            continue;
          }
          throw err;
        } finally {
          client.release();
        }
      }
      throw new Error("Could not upsert user.");
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const match = resolveIdentityMatch(state.users, { email, externalCustomerId, externalMemberId });

      if (!match) {
        const timestamp = nowIso();
        const user = {
          id: newId(),
          email,
          name,
          plan: requestedPlan,
          subscriptionStatus: requestedSubscriptionStatus,
          externalCustomerId,
          externalMemberId,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        state.users.push(user);
        await this._writeFileState(state);
        return mapUser(user);
      }

      const nextExternalCustomerId = match.externalCustomerId || externalCustomerId;
      const nextExternalMemberId = match.externalMemberId || externalMemberId;

      match.email = email || match.email;
      match.name = name || match.name;
      match.externalCustomerId = nextExternalCustomerId;
      match.externalMemberId = nextExternalMemberId;
      match.updatedAt = nowIso();

      await this._writeFileState(state);
      return mapUser(match);
    });
  }

  async updateUserBilling(update = {}) {
    const finder = {
      email: update.email ? String(update.email).trim().toLowerCase() : "",
      externalCustomerId: update.externalCustomerId ? String(update.externalCustomerId).trim() : "",
      externalMemberId: update.externalMemberId
        ? String(update.externalMemberId).trim()
        : update.memberId
          ? String(update.memberId).trim()
          : update.id
            ? String(update.id).trim()
            : ""
    };
    const plan = normalizePlan(update.plan, "free");
    const subscriptionStatus = normalizeStatus(update.subscriptionStatus, "inactive");

    if (this.mode === "postgres") {
      const row = await this._findUserByIdentityPostgres(this.pool, finder);
      if (!row) {
        return null;
      }

      const resolvedExternalCustomerId = row.external_customer_id || finder.externalCustomerId || null;
      const resolvedExternalMemberId = row.external_member_id || finder.externalMemberId || null;
      const updated = await this.pool.query(
        `
          UPDATE users
          SET
            plan = $2,
            subscription_status = $3,
            email = COALESCE(NULLIF($4, ''), email),
            external_customer_id = $5,
            external_member_id = $6,
            updated_at = NOW()
          WHERE id = $1
          RETURNING id, email, name, plan, subscription_status, external_customer_id, external_member_id, created_at, updated_at
        `,
        [row.id, plan, subscriptionStatus, finder.email, resolvedExternalCustomerId, resolvedExternalMemberId]
      );

      return mapUser({
        id: updated.rows[0].id,
        email: updated.rows[0].email,
        name: updated.rows[0].name,
        plan: updated.rows[0].plan,
        subscriptionStatus: updated.rows[0].subscription_status,
        externalCustomerId: updated.rows[0].external_customer_id,
        externalMemberId: updated.rows[0].external_member_id,
        createdAt: new Date(updated.rows[0].created_at).toISOString(),
        updatedAt: new Date(updated.rows[0].updated_at).toISOString()
      });
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const user = resolveIdentityMatch(state.users, finder);

      if (!user) {
        return null;
      }

      user.plan = plan;
      user.subscriptionStatus = subscriptionStatus;
      user.email = finder.email || user.email;
      user.externalCustomerId = user.externalCustomerId || finder.externalCustomerId;
      user.externalMemberId = user.externalMemberId || finder.externalMemberId;
      user.updatedAt = nowIso();

      await this._writeFileState(state);
      return mapUser(user);
    });
  }

  async listProjectsByUser(userId) {
    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `
          SELECT id, user_id, name, settings, materials, selections, created_at, updated_at
          FROM projects
          WHERE user_id = $1
          ORDER BY updated_at DESC
        `,
        [userId]
      );

      return result.rows.map((row) => mapProject({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        settings: row.settings,
        materials: row.materials,
        selections: row.selections,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }));
    }

    const state = await this._readFileState();
    return state.projects
      .filter((project) => project.userId === userId)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
      .map((project) => mapProject(project));
  }

  async createProject(userId, input = {}) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      throw new Error("Project name is required.");
    }

    const { settings, materials, selections } = normalizeProjectInput(input);

    if (this.mode === "postgres") {
      const id = newId();
      const result = await this.pool.query(
        `
          INSERT INTO projects (id, user_id, name, settings, materials, selections, created_at, updated_at)
          VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, NOW(), NOW())
          RETURNING id, user_id, name, settings, materials, selections, created_at, updated_at
        `,
        [id, userId, name, JSON.stringify(settings), JSON.stringify(materials), JSON.stringify(selections)]
      );

      const row = result.rows[0];
      return mapProject({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        settings: row.settings,
        materials: row.materials,
        selections: row.selections,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      });
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const timestamp = nowIso();
      const project = {
        id: newId(),
        userId,
        name,
        settings,
        materials,
        selections,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.projects.push(project);
      await this._writeFileState(state);
      return mapProject(project);
    });
  }

  async updateProject(userId, projectId, input = {}) {
    const updateName = typeof input.name === "string" ? input.name.trim() : null;
    const hasDataUpdate = input.payload !== undefined || input.settings !== undefined || input.materials !== undefined || input.selections !== undefined;
    const normalizedData = hasDataUpdate ? normalizeProjectInput(input) : null;

    if (this.mode === "postgres") {
      const existing = await this.pool.query(
        `
          SELECT id, user_id, name, settings, materials, selections, created_at, updated_at
          FROM projects
          WHERE id = $1 AND user_id = $2
          LIMIT 1
        `,
        [projectId, userId]
      );

      if (!existing.rows[0]) {
        return null;
      }

      const row = existing.rows[0];
      const result = await this.pool.query(
        `
          UPDATE projects
          SET
            name = COALESCE(NULLIF($3, ''), name),
            settings = COALESCE($4::jsonb, settings),
            materials = COALESCE($5::jsonb, materials),
            selections = COALESCE($6::jsonb, selections),
            updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, name, settings, materials, selections, created_at, updated_at
        `,
        [
          projectId,
          userId,
          updateName,
          normalizedData ? JSON.stringify(normalizedData.settings) : null,
          normalizedData ? JSON.stringify(normalizedData.materials) : null,
          normalizedData ? JSON.stringify(normalizedData.selections) : null
        ]
      );

      const updated = result.rows[0];
      return mapProject({
        id: updated.id,
        userId: updated.user_id,
        name: updated.name,
        settings: updated.settings,
        materials: updated.materials,
        selections: updated.selections,
        createdAt: new Date(updated.created_at).toISOString(),
        updatedAt: new Date(updated.updated_at).toISOString()
      });
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const project = state.projects.find((entry) => entry.id === projectId && entry.userId === userId);
      if (!project) {
        return null;
      }

      if (updateName !== null) {
        project.name = updateName || project.name;
      }
      if (normalizedData) {
        project.settings = normalizedData.settings;
        project.materials = normalizedData.materials;
        project.selections = normalizedData.selections;
      }
      project.updatedAt = nowIso();

      await this._writeFileState(state);
      return mapProject(project);
    });
  }

  async deleteProject(userId, projectId) {
    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
        [projectId, userId]
      );
      return result.rowCount > 0;
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const before = state.projects.length;
      state.projects = state.projects.filter((project) => !(project.id === projectId && project.userId === userId));
      if (state.projects.length === before) {
        return false;
      }
      await this._writeFileState(state);
      return true;
    });
  }

  async listPresetsByUser(userId) {
    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `
          SELECT id, user_id, type, name, data, created_at, updated_at
          FROM presets
          WHERE user_id = $1
          ORDER BY updated_at DESC
        `,
        [userId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        type: row.type,
        name: row.name,
        data: row.data && typeof row.data === "object" ? row.data : {},
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      }));
    }

    const state = await this._readFileState();
    return state.presets
      .filter((preset) => preset.userId === userId)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  }

  async createPreset(userId, input = {}) {
    const type = typeof input.type === "string" ? input.type.trim() : "";
    const name = typeof input.name === "string" ? input.name.trim() : "";
    const data = input.data && typeof input.data === "object" ? input.data : {};

    if (!type || !name) {
      throw new Error("Preset type and name are required.");
    }

    if (this.mode === "postgres") {
      const id = newId();
      const result = await this.pool.query(
        `
          INSERT INTO presets (id, user_id, type, name, data, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5::jsonb, NOW(), NOW())
          RETURNING id, user_id, type, name, data, created_at, updated_at
        `,
        [id, userId, type, name, JSON.stringify(data)]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        name: row.name,
        data: row.data,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const timestamp = nowIso();
      const preset = {
        id: newId(),
        userId,
        type,
        name,
        data,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.presets.push(preset);
      await this._writeFileState(state);
      return preset;
    });
  }

  async updatePreset(userId, presetId, input = {}) {
    const updateType = typeof input.type === "string" ? input.type.trim() : null;
    const updateName = typeof input.name === "string" ? input.name.trim() : null;
    const updateData = input.data !== undefined ? (input.data && typeof input.data === "object" ? input.data : {}) : null;

    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `
          UPDATE presets
          SET
            type = COALESCE(NULLIF($3, ''), type),
            name = COALESCE(NULLIF($4, ''), name),
            data = COALESCE($5::jsonb, data),
            updated_at = NOW()
          WHERE id = $1 AND user_id = $2
          RETURNING id, user_id, type, name, data, created_at, updated_at
        `,
        [presetId, userId, updateType, updateName, updateData ? JSON.stringify(updateData) : null]
      );

      if (!result.rows[0]) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        type: row.type,
        name: row.name,
        data: row.data,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      };
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const preset = state.presets.find((entry) => entry.id === presetId && entry.userId === userId);
      if (!preset) {
        return null;
      }

      if (updateType !== null) {
        preset.type = updateType || preset.type;
      }
      if (updateName !== null) {
        preset.name = updateName || preset.name;
      }
      if (updateData !== null) {
        preset.data = updateData;
      }
      preset.updatedAt = nowIso();

      await this._writeFileState(state);
      return preset;
    });
  }

  async deletePreset(userId, presetId) {
    if (this.mode === "postgres") {
      const result = await this.pool.query(
        `DELETE FROM presets WHERE id = $1 AND user_id = $2`,
        [presetId, userId]
      );
      return result.rowCount > 0;
    }

    return this._withFileLock(async () => {
      const state = await this._readFileState();
      const before = state.presets.length;
      state.presets = state.presets.filter((preset) => !(preset.id === presetId && preset.userId === userId));
      if (state.presets.length === before) {
        return false;
      }
      await this._writeFileState(state);
      return true;
    });
  }
}

function createUserStore(options = {}) {
  return new UserStore(options);
}

module.exports = {
  createUserStore,
  UserStore
};
