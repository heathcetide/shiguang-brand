import { Link } from 'react-router'
import { PageHeader } from '@/components/admin'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default function AdminNotFound() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="找不到这个管理页面" description="地址可能已失效，请从左侧菜单选择功能。" />
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-2">
          <p className="text-muted-foreground text-sm">该路由不在当前管理控制台中，或已被迁移。</p>
          <Button asChild>
            <Link to="/admin">返回工作台</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
