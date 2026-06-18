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
  type LinkTokenCreateResponse,
} from "plaid";
import { AccountType, CanonicalAccount, dollarsToCents, Provider } from "@clarifi/shared";
import { config } from "../config.js";
import { AppError } from "./app-error.js";

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
}

export interface PlaidExchangeResult {
  accessToken: string;
  itemId: string;
}

export interface PlaidAccountsResult {
  institutionName: string;
  accounts: CanonicalAccount[];
}

export interface PlaidAdapter {
  createLinkToken(userId: string): Promise<string>;
  exchangePublicToken(publicToken: string): Promise<PlaidExchangeResult>;
  getItemAccounts(accessToken: string): Promise<PlaidAccountsResult>;
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
