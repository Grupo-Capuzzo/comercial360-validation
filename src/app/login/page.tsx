import { login } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({
  searchParams,
}: LoginPageProps) {
  const params = await searchParams;
  const error = params.error;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f6f8",
        padding: "24px",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: "420px",
          background: "#ffffff",
          borderRadius: "20px",
          padding: "40px",
          boxShadow: "0 20px 60px rgba(15, 35, 64, 0.12)",
        }}
      >
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "#d6aa3a",
              color: "#0c203d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: 700,
              marginBottom: "20px",
            }}
          >
            C
          </div>

          <h1
            style={{
              margin: 0,
              color: "#0c203d",
              fontSize: "30px",
            }}
          >
            Comercial 360
          </h1>

          <p
            style={{
              marginTop: "8px",
              color: "#66758a",
            }}
          >
            Acesso interno Grupo Capuzzo
          </p>
        </div>

        <form action={login}>
          <label
            htmlFor="email"
            style={{
              display: "block",
              marginBottom: "8px",
              color: "#24364f",
              fontWeight: 600,
            }}
          >
            E-mail
          </label>

          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "14px 16px",
              border: "1px solid #d8dee8",
              borderRadius: "10px",
              marginBottom: "20px",
              fontSize: "16px",
            }}
          />

          <label
            htmlFor="password"
            style={{
              display: "block",
              marginBottom: "8px",
              color: "#24364f",
              fontWeight: 600,
            }}
          >
            Senha
          </label>

          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "14px 16px",
              border: "1px solid #d8dee8",
              borderRadius: "10px",
              marginBottom: "20px",
              fontSize: "16px",
            }}
          />

          {error ? (
            <div
              style={{
                background: "#fff3f3",
                border: "1px solid #f1c0c0",
                color: "#a52a2a",
                borderRadius: "10px",
                padding: "12px",
                marginBottom: "20px",
                fontSize: "14px",
              }}
            >
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            style={{
              width: "100%",
              border: 0,
              borderRadius: "10px",
              padding: "14px 18px",
              background: "#0c203d",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "16px",
              cursor: "pointer",
            }}
          >
            Entrar
          </button>
        </form>
      </section>
    </main>
  );
}
