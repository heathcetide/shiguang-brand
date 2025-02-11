////TODO ml
//package com.foodrecord.ml.model;
//
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
//import org.springframework.stereotype.Component;
//
//public class CollaborativeFilteringModel {
//    private int numFactors;
//    private double learningRate;
//    private double regularization;
//
//    private INDArray userFactors;
//    private INDArray itemFactors;
//
//    public CollaborativeFilteringModel(int numFactors, double learningRate, double regularization) {
//        this.numFactors = numFactors;
//        this.learningRate = learningRate;
//        this.regularization = regularization;
//    }
//
//    public void train(INDArray interactions, INDArray ratings) {
//        int numUsers = (int) interactions.max(0).getDouble(0) + 1;
//        int numItems = (int) interactions.max(1).getDouble(0) + 1;
//
//        // 初始化因子矩阵
//        userFactors = Nd4j.randn(numUsers, numFactors).mul(0.1);
//        itemFactors = Nd4j.randn(numItems, numFactors).mul(0.1);
//
//        // 交替最小二乘法(ALS)优化
//        for (int iter = 0; iter < 20; iter++) {
//            // 固定item因子，优化user因子
//            updateUserFactors(interactions, ratings);
//            // 固定user因子，优化item因子
//            updateItemFactors(interactions, ratings);
//        }
//    }
//
//    private void updateUserFactors(INDArray interactions, INDArray ratings) {
//        for (int u = 0; u < userFactors.rows(); u++) {
//            // 获取用户的交互项
//            INDArray userInteractions = interactions.getRow(u);
//            INDArray userRatings = ratings.getRow(u);
//
//            // 计算用户因子
//            INDArray A = itemFactors.transpose().mmul(itemFactors)
//                .add(Nd4j.eye(numFactors).mul(regularization));
//            INDArray b = itemFactors.transpose().mmul(userRatings);
//
//            // 解线性方程组
//            userFactors.putRow(u, solve(A, b));
//        }
//    }
//
//    private void updateItemFactors(INDArray interactions, INDArray ratings) {
//        for (int i = 0; i < itemFactors.rows(); i++) {
//            // 获取物品的交互用户
//            INDArray itemInteractions = interactions.getColumn(i);
//            INDArray itemRatings = ratings.getColumn(i);
//
//            // 计算物品因子
//            INDArray A = userFactors.transpose().mmul(userFactors)
//                .add(Nd4j.eye(numFactors).mul(regularization));
//            INDArray b = userFactors.transpose().mmul(itemRatings);
//
//            // 解线性方程组
//            itemFactors.putRow(i, solve(A, b));
//        }
//    }
//
//    private INDArray solve(INDArray A, INDArray b) {
//        // 确保矩阵 A 是对称正定的
//        if (!A.isMatrix() || A.rows() != A.columns()) {
//            throw new IllegalArgumentException("矩阵 A 必须是对称正定方阵！");
//        }
//
//        // 手动实现 Cholesky 分解
//        int n = A.rows();
//        INDArray L = Nd4j.zeros(n, n); // 初始化下三角矩阵 L
//        for (int i = 0; i < n; i++) {
//            for (int j = 0; j <= i; j++) {
//                double sum = 0;
//                for (int k = 0; k < j; k++) {
//                    sum += L.getDouble(i, k) * L.getDouble(j, k);
//                }
//                if (i == j) {
//                    L.putScalar(i, j, Math.sqrt(A.getDouble(i, i) - sum));
//                } else {
//                    L.putScalar(i, j, (A.getDouble(i, j) - sum) / L.getDouble(j, j));
//                }
//            }
//        }
//
//        // 前向替代：求解 Ly = b
//        INDArray y = Nd4j.zeros(b.shape());
//        for (int i = 0; i < n; i++) {
//            double sum = 0;
//            for (int j = 0; j < i; j++) {
//                sum += L.getDouble(i, j) * y.getDouble(j);
//            }
//            y.putScalar(i, (b.getDouble(i) - sum) / L.getDouble(i, i));
//        }
//
//        // 后向替代：求解 L^T x = y
//        INDArray x = Nd4j.zeros(b.shape());
//        INDArray LT = L.transpose();
//        for (int i = n - 1; i >= 0; i--) {
//            double sum = 0;
//            for (int j = i + 1; j < n; j++) {
//                sum += LT.getDouble(i, j) * x.getDouble(j);
//            }
//            x.putScalar(i, (y.getDouble(i) - sum) / LT.getDouble(i, i));
//        }
//
//        return x;
//    }
//
//
//
//    public INDArray predict(INDArray userItemPairs) {
//        INDArray predictions = Nd4j.zeros(userItemPairs.rows(), 1);
//        for (int i = 0; i < userItemPairs.rows(); i++) {
//            int userId = (int) userItemPairs.getDouble(i, 0);
//            int itemId = (int) userItemPairs.getDouble(i, 1);
//
//            INDArray userFactor = userFactors.getRow(userId);
//            INDArray itemFactor = itemFactors.getRow(itemId);
//
//            double prediction = userFactor.mmul(itemFactor.transpose()).getDouble(0);
//            predictions.putScalar(i, 0, prediction);
//        }
//        return predictions;
//    }
//
//
//
//
//}