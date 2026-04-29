import { Button, Card, CardHeader } from '@heroui/react';
import { cn } from '../utils/cn';
import clsx from 'clsx';

export function Tokens() {
  const cond = true;
  return (
    <div>
      <Button className="bg-primary text-primary-100 border-divider shadow-small">x</Button>
      <Card className={cn('bg-content1', 'shadow-medium', cond && 'text-tiny')}>
        <CardHeader className={`text-tiny rounded-medium ${cond ? 'bg-primary-500' : 'bg-content2'}`}>h</CardHeader>
      </Card>
      <div className={clsx({ 'bg-primary-100': cond, 'border-secondary': !cond })}>x</div>
      <div className="leading-inherit scrollbar-hide tap-highlight-transparent">x</div>
      <div className="bg-secondary text-secondary-500 bg-content4">x</div>
    </div>
  );
}
