/**
 * Read-only Nano RPC client.
 *
 * Talks to a pool of public Nano RPC nodes over their JSON-RPC endpoints and
 * uses plural query methods (`accounts_balances`, `accounts_frontiers`) so a
 * whole page of addresses costs two upstream requests rather than 2N.
 */

/** @typedef {{ name: string, url: string }} RpcNode */
/** @typedef {{ address: string, balanceRaw: string, receivableRaw: string, opened: boolean }} AccountsState */
/** @typedef {{ nodes?: RpcNode[], timeoutMs?: number, fetchImpl?: typeof fetch, batchSize?: number }} RpcClientOptions */

/** @type {RpcNode[]} */
export const DEFAULT_NODES = [
  { name: 'rainstorm.city', url: 'https://rainstorm.city/api' },
  { name: 'nanoslo.0x.no', url: 'https://nanoslo.0x.no/proxy' },
  { name: 'rpc.nano.to', url: 'https://rpc.nano.to' },
];

export class RpcError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RpcError';
  }
}

export class NanoRpcClient {
  /** @type {RpcNode[]} */
  nodes;
  /** @type {number} */
  timeoutMs;
  /** @type {typeof fetch} */
  fetchImpl;
  /** @type {number} */
  batchSize;
  /** @type {number} */
  preferred = 0;

  /** @param {RpcClientOptions} [options] */
  constructor(options = {}) {
    this.nodes = options.nodes && options.nodes.length > 0 ? options.nodes : DEFAULT_NODES;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.batchSize = options.batchSize ?? 250;
  }

  /** @returns {string[]} */
  get nodeNames() {
    return this.nodes.map((n) => n.name);
  }

  /**
   * Call a single JSON-RPC method with automatic node failover.
   * @template T
   * @param {string} action
   * @param {Record<string, unknown>} body
   * @returns {Promise<T>}
   */
  async call(action, body) {
    /** @type {string[]} */
    const errors = [];
    for (let attempt = 0; attempt < this.nodes.length; attempt++) {
      const node = this.nodes[(this.preferred + attempt) % this.nodes.length];
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await this.fetchImpl(node.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, ...body }),
            signal: controller.signal,
          });
          if (!response.ok) throw new RpcError(`HTTP ${response.status}`);
          const json = await response.json();
          if (json && typeof json === 'object' && 'error' in json && json.error) {
            throw new RpcError(String(json.error));
          }
          this.preferred = this.nodes.indexOf(node);
          return /** @type {T} */ (json);
        } finally {
          clearTimeout(timer);
        }
      } catch (error) {
        errors.push(`${node.name}: ${/** @type {Error} */ (error).message}`);
      }
    }
    throw new RpcError(`All RPC endpoints failed (${errors.join('; ')})`);
  }

  /**
   * Fetch confirmed balances and receivables for many accounts.
   * @param {string[]} addresses
   * @returns {Promise<Map<string, { balanceRaw: string, receivableRaw: string }>>}
   */
  async accountsBalances(addresses) {
    /** @type {Map<string, { balanceRaw: string, receivableRaw: string }>} */
    const out = new Map();
    for (const chunk of chunkArray(addresses, this.batchSize)) {
      const json = await this.call('accounts_balances', { accounts: chunk });
      const balances = json.balances ?? {};
      for (const [address, entry] of Object.entries(balances)) {
        out.set(address, {
          balanceRaw: entry.balance ?? '0',
          receivableRaw: entry.receivable ?? entry.pending ?? '0',
        });
      }
    }
    return out;
  }

  /**
   * Fetch frontiers, which reveal which accounts are opened.
   * @param {string[]} addresses
   * @returns {Promise<Set<string>>}
   */
  async accountsFrontiers(addresses) {
    /** @type {Set<string>} */
    const opened = new Set();
    for (const chunk of chunkArray(addresses, this.batchSize)) {
      const json = await this.call('accounts_frontiers', { accounts: chunk });
      const frontiers = json.frontiers ?? {};
      for (const [address, frontier] of Object.entries(frontiers)) {
        if (frontier && !/^0+$/.test(frontier)) opened.add(address);
      }
    }
    return opened;
  }

  /**
   * Combined helper returning ready-to-cache state for a set of addresses.
   * @param {string[]} addresses
   * @returns {Promise<AccountsState[]>}
   */
  async fetchState(addresses) {
    const unique = [...new Set(addresses)];
    if (unique.length === 0) return [];
    const [balances, frontiers] = await Promise.all([
      this.accountsBalances(unique),
      this.accountsFrontiers(unique),
    ]);
    return unique.map((address) => ({
      address,
      balanceRaw: balances.get(address)?.balanceRaw ?? '0',
      receivableRaw: balances.get(address)?.receivableRaw ?? '0',
      opened: frontiers.has(address),
    }));
  }
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
function chunkArray(items, size) {
  /** @type {T[][]} */
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
