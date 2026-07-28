import { Alert, Button, Card, Empty, Skeleton, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

/**
 * Loading, empty and error states. Skeletons rather than a spinner on white —
 * the layout should already be visible while data arrives.
 */

export function TableSkeleton({ rows = 8 }: { rows?: number }): React.ReactElement {
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton.Input key={index} active block style={{ height: 32 }} />
      ))}
    </Space>
  );
}

export function CardSkeleton({ height = 120 }: { height?: number }): React.ReactElement {
  return <Skeleton.Node active style={{ width: '100%', height }} />;
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}): React.ReactElement {
  return (
    <Alert
      type="error"
      showIcon
      message="Не удалось загрузить данные"
      description={message}
      action={
        onRetry === undefined ? undefined : (
          <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
            Повторить
          </Button>
        )
      }
    />
  );
}

export function EmptyState({
  description,
  action,
}: {
  description: string;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <Card variant="borderless">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
        {action}
      </Empty>
    </Card>
  );
}
