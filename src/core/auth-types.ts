export type AuthenticatedUser = {
  id: string;
  email: string | null;
  displayName: string | null;
};

export type AuthResult = {
  accessToken: string;
  expiresAt: string;
  user: AuthenticatedUser;
};

export type OtpRequestResult = {
  ok: true;
  expiresAt: string;
  otp?: string;
};

export type AuthSession = {
  accessToken: string;
  expiresAt: string;
  user: AuthenticatedUser;
};
