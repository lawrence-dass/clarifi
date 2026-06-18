import {
  AccountType as PlaidAccountType,
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type AccountsGetResponse,
  type ItemPublicTokenExchangeResponse,
  type JWKPublicKey,
  type LinkTokenCreateResponse,
  type Transaction,
  type TransactionsSyncResponse,
  type WebhookVerificationKeyGetResponse,
} from "plaid";
import { AccountType, CanonicalAccount, CanonicalTransaction, dollarsToCents, Provider } from "@clarifi/shared";
import { config } from "../config.js";
import { AppError } from "./app-error.js";

type PublicJsonWebKey = Record<string, unknown>;

export interface PlaidClientLike {
  linkTokenCreate(input: {
    client_name: string;
    language: string;
    country_codes: CountryCode[];
    products: Products[];
    user: { client_user_id: string };
  }): Promise<{ data: LinkTokenCreateResponse }>;
  itemPublicTokenExchange(input: { public_token: string }): Promise<{ data: ItemPublicTokenExchangeResponse }>;
  accountsGet(input: { access_token: string }): Promise<{ data: AccountsGetResponse }>;
  transactionsSync(input: {
    access_token: string;
    cursor?: string;
    count?: number;
    options?: { include_original_description?: boolean | null };
  }): Promise<{ data: TransactionsSyncResponse }>;
  webhookVerificationKeyGet(input: { key_id: string }): Promise<{ data: WebhookVerificationKeyGetResponse }>;
}

export interface PlaidExchangeResult {
  accessToken: string;
  itemId: string;
}

export interface PlaidAccountsResult {
  institutionName: string;
  accounts: CanonicalAccount[];
}

export interface PlaidSyncResult {
  added: CanonicalTransaction[];
  modified: CanonicalTransaction[];
  removedProviderTransactionIds: string[];
  nextCursor: string;
  hasMore: boolean;
}

export interface PlaidAdapter {
  createLinkToken(userId: string): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult>;
  getItemAccounts(accessToken: string): Promise<PlaidAccountsResult>;
  syncTransactions(accessToken: string, cursor?: string): Promise<PlaidSyncResult>;
  getWebhookVerificationKey(keyId: string): Promise<PublicJsonWebKey>;
}

export function createPlaidAdapter(client?: PlaidClientLike): PlaidAdapter {
  return {
    async createLinkToken(userId: string): Promise<string> {
      const response = await getClient(client).linkTokenCreate({
        client_name: "Clarifi",
        language: "en",
        country_codes: [CountryCode.Ca, CountryCode.Us],
        products: [Products.Transactions],
        user: { client_user_id: userId },
      });
      return response.data.link_token;
    },

    async exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult> {
      const response = await getClient(client).itemPublicTokenExchange({ public_token: publicToken });
      return {
        accessToken: response.data.access_token,
        itemId: response.data.item_id,
      };
    },

    async getItemAccounts(accessToken: string): Promise<PlaidAccountsResult> {
      const response = await getClient(client).accountsGet({ access_token: accessToken });
      const institutionName = response.data.item.institution_name?.trim() || "Plaid Institution";
      return {
        institutionName,
        accounts: response.data.accounts.map((account) => mapAccount(account, institutionName)),
      };
    },

    async syncTransactions(accessToken: string, cursor?: string): Promise<PlaidSyncResult> {
      const response = await getClient(client).transactionsSync({
        access_token: accessToken,
        ...(cursor ? { cursor } : {}),
        count: 500,
        options: { include_original_description: true },
      });
      return {
        added: response.data.added.map(mapTransaction),
        modified: response.data.modified.map(mapTransaction),
        removedProviderTransactionIds: response.data.removed.map((transaction) => transaction.transaction_id),
        nextCursor: response.data.next_cursor,
        hasMore: response.data.has_more,
      };
    },

    async getWebhookVerificationKey(keyId: string): Promise<PublicJsonWebKey> {
      const response = await getClient(client).webhookVerificationKeyGet({ key_id: keyId });
      return mapWebhookVerificationKey(response.data.key);
    },
  };
}

export const plaidAdapter = createPlaidAdapter();

let defaultPlaidClient: PlaidClientLike | undefined;

function getClient(client?: PlaidClientLike): PlaidClientLike {
  if (client) return client;
  defaultPlaidClient ??= createPlaidClient();
  return defaultPlaidClient;
}

function createPlaidClient(): PlaidClientLike {
  if (!config.PLAID_CLIENT_ID || !config.PLAID_SECRET) {
    throw new AppError("PLAID_NOT_CONFIGURED", 503, "Plaid is not configured");
  }

  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[config.PLAID_ENV],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": config.PLAID_CLIENT_ID,
          "PLAID-SECRET": config.PLAID_SECRET,
        },
      },
    }),
  );
}

function mapAccount(account: AccountBase, institutionName: string): CanonicalAccount {
  const currentBalance = account.balances.current ?? account.balances.available;
  const currency = account.balances.iso_currency_code ?? "CAD";

  return CanonicalAccount.parse({
    provider: Provider.plaid,
    providerAccountId: account.account_id,
    institutionName,
    accountType: mapAccountType(account),
    balanceCents: dollarsToCents(currentBalance ?? 0),
    currency,
    mask: account.mask ?? undefined,
  });
}

function mapAccountType(account: AccountBase): AccountType {
  const subtype = account.subtype?.toLowerCase();
  if (subtype === "checking") return AccountType.checking;
  if (subtype === "savings") return AccountType.savings;
  if (subtype === "credit card") return AccountType.credit_card;
  if (account.type === PlaidAccountType.Credit) return AccountType.credit_card;
  return AccountType.other;
}

function mapTransaction(transaction: Transaction): CanonicalTransaction {
  const rawDescription = transaction.original_description?.trim()
    || transaction.name?.trim()
    || transaction.merchant_name?.trim()
    || "Plaid transaction";
  const currency = transaction.iso_currency_code ?? "CAD";

  return CanonicalTransaction.parse({
    providerTransactionId: transaction.transaction_id,
    providerAccountId: transaction.account_id,
    date: new Date(`${transaction.date}T00:00:00.000Z`),
    // Plaid's transaction sign is inverted from Clarifi's convention:
    // positive means money out, so normalize once at the adapter boundary.
    amountCents: -dollarsToCents(transaction.amount),
    currency,
    rawDescription,
    merchantName: transaction.merchant_name ?? undefined,
    pending: transaction.pending,
    pendingTransactionId: transaction.pending_transaction_id,
  });
}

function mapWebhookVerificationKey(key: JWKPublicKey): PublicJsonWebKey {
  return {
    kty: key.kty,
    kid: key.kid,
    use: key.use,
    alg: key.alg,
    crv: key.crv,
    x: key.x,
    y: key.y,
  };
}
