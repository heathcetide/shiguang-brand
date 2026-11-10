import { Link } from 'react-router';
import { PageHeader } from '../components/admin/PageHeader';
export default function AdminNotFound(){return <section className="admin-panel"><PageHeader title="找不到这个管理页面" description="地址可能已失效，请从左侧菜单选择功能。"/><Link to="/admin" className="admin-button">返回工作台</Link></section>;}
