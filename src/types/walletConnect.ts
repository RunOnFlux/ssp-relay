export type WalletConnectActionType =
  | 'SESSION_PROPOSAL'
  | 'PERSONAL_SIGN'
  | 'ETH_SIGN'
  | 'ETH_SIGN_TYPED_DATA'
  | 'ETH_SEND_TRANSACTION'
  | 'ETH_SIGN_TRANSACTION'
  | 'SWITCH_CHAIN'
  | 'ADD_CHAIN';

export interface WalletConnectAction {
  id: string;
  action: WalletConnectActionType;
  wkIdentity: string;
  method: string;
  params: unknown[];
  metadata?: {
    dappName: string;
    dappUrl: string;
  };
  chain: string;
  timestamp: Date;
}

export interface WalletConnectResponse {
  requestId: string;
  approved: boolean;
  result?: unknown;
  error?: string;
}
