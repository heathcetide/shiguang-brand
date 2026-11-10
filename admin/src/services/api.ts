import axios from 'axios';
import { adminLoginPath, classifyAdminSession } from './adminSession';

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

// Request interceptor to add token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('adminToken');
    if (token && !config.headers.Authorization) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor to handle errors (like 401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const sessionFailure = classifyAdminSession({
      status: error.response?.status,
      code: error.response?.data?.code,
    });
    if (sessionFailure) {
      localStorage.removeItem('adminToken');
      if (window.location.pathname !== '/login') window.location.href = adminLoginPath(sessionFailure);
    }
    if (
      error.response?.status === 403
      && error.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED'
      && window.location.pathname !== '/change-password'
    ) {
      window.location.href = '/change-password';
    }
    return Promise.reject(error);
  }
);

export default api;
