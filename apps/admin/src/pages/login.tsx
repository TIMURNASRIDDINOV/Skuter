import { useLogin } from '@refinedev/core';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { LockOutlined, MailOutlined } from '@ant-design/icons';

interface Credentials {
  email: string;
  password: string;
}

export function LoginPage(): React.ReactElement {
  const { mutate: login, isPending, data } = useLogin<Credentials>();
  const failed = data?.success === false;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f0f2f5',
        padding: 16,
      }}
    >
      <Card style={{ width: 380 }}>
        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 4 }}>
          Ozo Thunder
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
          Панель управления парком
        </Typography.Paragraph>

        {failed ? (
          <Alert
            type="error"
            showIcon
            message={data.error?.name ?? 'Не удалось войти'}
            description={data.error?.message}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Form<Credentials>
          layout="vertical"
          onFinish={(values) => {
            login(values);
          }}
          initialValues={{ email: 'admin@demo.uz', password: 'demo1234' }}
        >
          <Form.Item
            name="email"
            label="Почта"
            rules={[{ required: true, type: 'email', message: 'Введите корректную почту' }]}
          >
            <Input prefix={<MailOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, message: 'Введите пароль' }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={isPending}>
            Войти
          </Button>
        </Form>
      </Card>
    </div>
  );
}
