import { Card, Screen, Txt } from '../components/ui';
import { RULE_SECTIONS } from '../features/onboarding/rulesCopy';

export default function HowItWorks() {
  return (
    <Screen edges={[]}>
      {RULE_SECTIONS.map((s) => (
        <Card key={s.title}>
          <Txt variant="heading">{s.title}</Txt>
          <Txt variant="body" muted>{s.body}</Txt>
        </Card>
      ))}
    </Screen>
  );
}
