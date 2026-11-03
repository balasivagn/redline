import { AuthLayout } from '../layouts/AuthLayout';

export function LoginPage() {
  return (
    <AuthLayout title="Login">
      <div className="form-row">
        <input aria-label="Email" placeholder="you@example.com" />
      </div>
      <div className="form-row">
        <button type="button">Sign in</button>
      </div>
    </AuthLayout>
  );
}
