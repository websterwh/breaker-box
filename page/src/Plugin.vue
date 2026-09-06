<template>
  <div class="breaker-box">
    <div class="toolbar">
      <h1>Breaker Box</h1>
      <div class="toolbar-right">
        <button class="btn" @click="checkSecretExists" :disabled="!configComplete || checking">
          {{ checking ? 'Checking…' : 'Refresh status' }}
        </button>
        <button class="btn btn-icon" @click="showSettings = true" title="Settings">⚙</button>
      </div>
    </div>

    <div v-if="!configComplete" class="banner banner-warn">
      Not configured yet. Open Settings (⚙) and fill in your proxy Worker URL, Cloudflare API
      token, Account ID, and Worker script name.
    </div>

    <div v-if="error" class="banner banner-warn">{{ error }}</div>
    <div v-if="successMessage" class="banner banner-ok">{{ successMessage }}</div>

    <div v-if="configComplete" class="status-card">
      <div class="status-row">
        <span class="label">Secret on Worker</span>
        <span :class="['badge', secretExists === true ? 'badge-set' : secretExists === false ? 'badge-clear' : 'badge-unknown']">
          {{ secretExists === true ? 'SET' : secretExists === false ? 'NOT SET' : 'UNKNOWN' }}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Last set from this plugin</span>
        <span class="value">
          <template v-if="lastKnownState.value">
            {{ modeLabel(lastKnownState.value) }} — {{ fmtAge(lastKnownState.setAt) }}
          </template>
          <template v-else>—</template>
        </span>
      </div>
      <div class="status-row" v-if="lastKnownState.revertAt">
        <span class="label">Auto-reverts</span>
        <span class="value">{{ fmtRevertAt(lastKnownState.revertAt) }}</span>
      </div>
    </div>

    <label class="timer-field" v-if="configComplete">
      <span>Auto-revert to Normal after</span>
      <select v-model.number="revertMinutes">
        <option :value="0">No timer - stays until I clear it</option>
        <option :value="5">5 minutes</option>
        <option :value="15">15 minutes</option>
        <option :value="30">30 minutes</option>
        <option :value="60">1 hour</option>
        <option :value="180">3 hours</option>
      </select>
      <small>Applies to Restarting/Under Maintenance below. Restarting also
        auto-reverts the moment your site responds again, whichever comes
        first. Requires the timer to be set up on the maintenance-proxy
        Worker itself (see README) - otherwise this is silently ignored.</small>
    </label>

    <div class="button-row">
      <button class="btn btn-off" :disabled="!configComplete || busy" @click="setMode('off')">
        {{ busy === 'off' ? 'Clearing…' : 'Normal' }}
      </button>
      <button class="btn btn-restart" :disabled="!configComplete || busy" @click="setMode('R')">
        {{ busy === 'R' ? 'Setting…' : 'Restarting' }}
      </button>
      <button class="btn btn-maint" :disabled="!configComplete || busy" @click="setMode('M')">
        {{ busy === 'M' ? 'Setting…' : 'Under Maintenance' }}
      </button>
    </div>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <div class="modal">
        <h2>Settings</h2>

        <label class="field">
          <span>Proxy Worker URL</span>
          <input v-model="form.proxyUrl" type="text" placeholder="https://breaker-box-worker.you.workers.dev" />
          <small>Your deployed breaker-box-worker Worker.</small>
        </label>

        <label class="field">
          <span>Cloudflare API Token</span>
          <input v-model="form.apiToken" type="password" placeholder="your Cloudflare API token" />
          <small>Needs "Edit Cloudflare Workers" permission.</small>
        </label>

        <label class="field">
          <span>Account ID</span>
          <input v-model="form.accountId" type="text" placeholder="Cloudflare account ID" />
        </label>

        <label class="field">
          <span>Worker Script Name</span>
          <input v-model="form.scriptName" type="text" placeholder="e.g. maintenance-proxy" />
        </label>

        <label class="field">
          <span>Secret Name</span>
          <input v-model="form.secretName" type="text" placeholder="MODE" />
        </label>

        <div class="modal-actions">
          <button class="btn" @click="showSettings = false">Cancel</button>
          <button class="btn btn-primary" @click="saveSettings">Save</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
const PLUGIN_NAME = "breaker-box";

const MODE_LABELS = {
  M: "Under Maintenance",
  R: "Restarting",
  off: "Cleared (auto-detect)",
};

export default {
  name: "BreakerBoxPlugin",
  data() {
    return {
      apiBase: "/api/v1",
      authToken: null,
      showSettings: false,
      error: null,
      successMessage: null,
      checking: false,
      busy: null, // 'M' | 'R' | 'off' | null
      secretExists: null, // true | false | null (unknown)
      lastKnownState: { value: null, setAt: null, revertAt: null },
      revertMinutes: 0, // 0 = no timer
      form: {
        proxyUrl: "",
        apiToken: "",
        accountId: "",
        scriptName: "",
        secretName: "MODE",
      },
    };
  },
  computed: {
    configComplete() {
      const f = this.form;
      return !!(f.proxyUrl && f.apiToken && f.accountId && f.scriptName && f.secretName);
    },
  },
  mounted() {
    this.authToken = this.findAuthToken();
    this.loadSettings().then(() => {
      if (this.configComplete) this.checkSecretExists();
    });
  },
  methods: {
    modeLabel(v) {
      return MODE_LABELS[v] || v;
    },
    fmtAge(ts) {
      if (!ts) return "unknown time";
      const mins = Math.round((Date.now() - ts) / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
      const days = Math.round(hrs / 24);
      return `${days} day${days === 1 ? "" : "s"} ago`;
    },
    fmtRevertAt(ts) {
      if (!ts) return "—";
      const mins = Math.round((ts - Date.now()) / 60000);
      if (mins <= 0) return "any moment now";
      if (mins < 60) return `in ~${mins} min`;
      const hrs = Math.round(mins / 60);
      return `in ~${hrs} hr${hrs === 1 ? "" : "s"}`;
    },

    // --- MOS auth token, same scanning approach as smart-health-dashboard ---
    findAuthToken() {
      const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
      const scanStorage = (storage) => {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          const val = storage.getItem(key);
          if (!val) continue;
          if (jwtPattern.test(val)) return val;
          try {
            const parsed = JSON.parse(val);
            const candidates = [
              parsed?.token, parsed?.accessToken, parsed?.access_token,
              parsed?.jwt, parsed?.authToken, parsed?.user?.token, parsed?.state?.token,
            ];
            for (const c of candidates) {
              if (typeof c === "string" && jwtPattern.test(c)) return c;
            }
          } catch (e) {
            // Not JSON.
          }
        }
        return null;
      };
      return scanStorage(window.localStorage) || scanStorage(window.sessionStorage);
    },
    mosAuthHeaders() {
      const headers = { Accept: "application/json" };
      if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
      return headers;
    },

    // --- Plugin settings: MOS server-side store, localStorage fallback ---
    async loadSettings() {
      try {
        const res = await fetch(`${this.apiBase}/mos/plugins/settings/${PLUGIN_NAME}`, {
          headers: this.mosAuthHeaders(),
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const settings = data?.settings || data || {};
        if (settings.form) this.form = { ...this.form, ...settings.form };
        if (settings.lastKnownState) this.lastKnownState = settings.lastKnownState;
      } catch (e) {
        this.loadLocalSettingsFallback();
      }
    },
    async saveSettingsToServer() {
      try {
        const res = await fetch(`${this.apiBase}/mos/plugins/settings/${PLUGIN_NAME}`, {
          method: "POST",
          headers: { ...this.mosAuthHeaders(), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ form: this.form, lastKnownState: this.lastKnownState }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        this.saveLocalSettingsFallback();
      }
    },
    loadLocalSettingsFallback() {
      try {
        const saved = window.localStorage.getItem("breaker-box-settings");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.form) this.form = { ...this.form, ...parsed.form };
          if (parsed.lastKnownState) this.lastKnownState = parsed.lastKnownState;
        }
      } catch (e) {
        // No settings yet - fine, starts empty.
      }
    },
    saveLocalSettingsFallback() {
      try {
        window.localStorage.setItem(
          "breaker-box-settings",
          JSON.stringify({ form: this.form, lastKnownState: this.lastKnownState })
        );
      } catch (e) {
        // Storage unavailable - settings just won't persist.
      }
    },
    saveSettings() {
      this.showSettings = false;
      this.error = null;
      this.saveSettingsToServer();
      if (this.configComplete) this.checkSecretExists();
    },

    // --- Cloudflare API, via the user's own proxy Worker ---
    secretsUrl() {
      const base = this.form.proxyUrl.replace(/\/$/, "");
      return `${base}/client/v4/accounts/${this.form.accountId}/workers/scripts/${this.form.scriptName}/secrets`;
    },
    cfAuthHeaders() {
      return {
        Authorization: `Bearer ${this.form.apiToken}`,
        "Content-Type": "application/json",
      };
    },
    async checkSecretExists() {
      if (!this.configComplete) return;
      this.checking = true;
      this.error = null;
      try {
        const res = await fetch(this.secretsUrl(), { headers: this.cfAuthHeaders() });
        const data = await res.json();
        if (!res.ok || data.success === false) {
          throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
        }
        const names = (data.result || []).map((s) => s.name);
        this.secretExists = names.includes(this.form.secretName);
      } catch (e) {
        this.secretExists = null;
        this.error = `Couldn't check secret status: ${e.message}`;
      } finally {
        this.checking = false;
      }
    },
    revertSecretName() {
      return `${this.form.secretName}_REVERT_AT`;
    },
    // DELETE is idempotent from the user's perspective: Cloudflare returns
    // "Binding '<name>' not found" when the secret already doesn't exist,
    // which just means we're already in the state we wanted, not a failure.
    async deleteSecretIfPresent(name) {
      const res = await fetch(`${this.secretsUrl()}/${name}`, {
        method: "DELETE",
        headers: this.cfAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      const alreadyGone = !res.ok && /not found/i.test(data?.errors?.[0]?.message || "");
      if (!res.ok && !alreadyGone) {
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
    },
    async putSecret(name, text) {
      const res = await fetch(this.secretsUrl(), {
        method: "PUT",
        headers: this.cfAuthHeaders(),
        body: JSON.stringify({ name, text, type: "secret_text" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
    },
    async setMode(state) {
      if (!this.configComplete || this.busy) return;
      this.busy = state;
      this.error = null;
      this.successMessage = null;
      try {
        let revertAt = null;

        if (state === "off") {
          await this.deleteSecretIfPresent(this.form.secretName);
          await this.deleteSecretIfPresent(this.revertSecretName());
        } else {
          await this.putSecret(this.form.secretName, state);
          if (this.revertMinutes > 0) {
            revertAt = Date.now() + this.revertMinutes * 60000;
            await this.putSecret(this.revertSecretName(), String(revertAt));
          } else {
            await this.deleteSecretIfPresent(this.revertSecretName());
          }
        }

        this.lastKnownState = { value: state, setAt: Date.now(), revertAt };
        this.saveSettingsToServer();
        this.successMessage = `${this.modeLabel(state)} applied.`;
        await this.checkSecretExists();
      } catch (e) {
        this.error = `Failed to set mode: ${e.message}`;
      } finally {
        this.busy = null;
      }
    },
  },
};
</script>

<style scoped>
.breaker-box {
  font-family: system-ui, sans-serif;
  padding: 1rem;
  max-width: 640px;
  color: #e8e8ec;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}
.toolbar h1 {
  font-size: 1.25rem;
  margin: 0;
  color: #f2f2f4;
}
.toolbar-right {
  display: flex;
  gap: 0.5rem;
}
.banner {
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.banner-warn {
  background: #78350f;
  color: #fde68a;
}
.banner-ok {
  background: #14532d;
  color: #bbf7d0;
}
.status-card {
  border: 1px solid #2a2a30;
  background: #17171b;
  border-radius: 8px;
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
}
.status-row {
  display: flex;
  justify-content: space-between;
  padding: 0.25rem 0;
}
.status-row .label {
  color: #9a9aa2;
}
.status-row .value {
  color: #e8e8ec;
}
.note {
  font-size: 0.8rem;
  color: #7d7d85;
  margin: 0.5rem 0 0;
}
.badge {
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-set { background: #4c1d1d; color: #fca5a5; }
.badge-clear { background: #14532d; color: #86efac; }
.badge-unknown { background: #374151; color: #d1d5db; }

.timer-field {
  display: block;
  margin-bottom: 1rem;
}
.timer-field span {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.3rem;
  color: #cbd5e1;
}
.timer-field select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #3a3a42;
  background: #0f0f13;
  color: #e8e8ec;
  box-sizing: border-box;
  font-size: 0.9rem;
}
.timer-field small {
  display: block;
  color: #7d7d85;
  font-size: 0.75rem;
  margin-top: 0.3rem;
  line-height: 1.4;
}

.button-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid #3a3a42;
  background: #1f1f24;
  color: #e8e8ec;
  cursor: pointer;
  font-size: 0.9rem;
}
.btn:not(:disabled):hover {
  border-color: #55555f;
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.btn-icon {
  padding: 0.4rem 0.6rem;
}
.btn-maint {
  background: #78350f;
  border-color: #d97706;
  color: #fde68a;
}
.btn-restart {
  background: #1e3a8a;
  border-color: #2563eb;
  color: #bfdbfe;
}
.btn-off {
  background: #14532d;
  border-color: #16a34a;
  color: #bbf7d0;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal {
  background: #18181d;
  color: #e8e8ec;
  border: 1px solid #2a2a30;
  padding: 1.25rem 1.5rem;
  border-radius: 10px;
  width: 90%;
  max-width: 420px;
}
.modal h2 {
  margin-top: 0;
  font-size: 1.1rem;
  color: #f2f2f4;
}
.field {
  display: block;
  margin-bottom: 0.75rem;
}
.field span {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.2rem;
  color: #cbd5e1;
}
.field input {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #3a3a42;
  background: #0f0f13;
  color: #e8e8ec;
  box-sizing: border-box;
}
.field input::placeholder {
  color: #6b6b73;
}
.field small {
  color: #7d7d85;
  font-size: 0.75rem;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
</style>
