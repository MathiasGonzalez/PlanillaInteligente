import { Body, Container, Head, Heading, Html, render, Section, Text } from 'react-email';

const ink = '#1c1917';
const paper = '#faf7f2';
const accent = '#0f766e';

interface LoginCodeProps {
  code: string;
  expiresInMinutes: number;
}

export function LoginCodeEmail({ code, expiresInMinutes }: LoginCodeProps) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: paper, color: ink, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <Container style={{ padding: '32px 20px' }}>
          <Heading style={{ fontSize: '24px', fontWeight: 600 }}>Tu código para entrar</Heading>
          <Text>Usalo para iniciar sesión en PlanillaInteligente. Vence en {expiresInMinutes} minutos.</Text>
          <Section style={{ backgroundColor: '#ffffff', borderRadius: '16px', padding: '16px 20px' }}>
            <Text style={{ fontSize: '32px', letterSpacing: '0.3em', color: accent, margin: 0 }}>{code}</Text>
          </Section>
          <Text>Si no pediste este código, podés ignorar este mensaje.</Text>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderLoginCode(props: LoginCodeProps) {
  const element = <LoginCodeEmail {...props} />;
  const html = await render(element);
  const text = await render(element, { plainText: true });
  return {
    subject: 'Tu código de PlanillaInteligente',
    html,
    text,
  };
}
