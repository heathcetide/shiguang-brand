// TODO ml - module
//package com.foodrecord.ml.model.layer;
//
//import org.deeplearning4j.nn.api.Layer;
//import org.deeplearning4j.nn.api.ParamInitializer;
//import org.deeplearning4j.nn.conf.GradientNormalization;
//import org.deeplearning4j.nn.conf.InputPreProcessor;
//import org.deeplearning4j.nn.conf.NeuralNetConfiguration;
//import org.deeplearning4j.nn.conf.inputs.InputType;
//import org.deeplearning4j.nn.conf.memory.LayerMemoryReport;
//import org.deeplearning4j.nn.gradient.DefaultGradient;
//import org.deeplearning4j.nn.gradient.Gradient;
//import org.deeplearning4j.nn.workspace.LayerWorkspaceMgr;
//import org.deeplearning4j.optimize.api.TrainingListener;
//import org.nd4j.common.primitives.Pair;
//import org.nd4j.linalg.api.buffer.DataType;
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.factory.Nd4j;
//import org.nd4j.linalg.learning.regularization.Regularization;
//import org.nd4j.linalg.ops.transforms.Transforms;
//
//import java.util.Collection;
//import java.util.List;
//
//public class AttentionLayer extends org.deeplearning4j.nn.conf.layers.Layer {
//    private int nIn;
//    private int nOut;
//
//    public AttentionLayer(int nIn, int nOut) {
//        this.nIn = nIn;
//        this.nOut = nOut;
//    }
//
//    @Override
//    public Layer instantiate(NeuralNetConfiguration conf, Collection<TrainingListener> listeners, int layerIndex, INDArray paramsView, boolean initializeParams, DataType networkDataType) {
//        return new AttentionLayerInstance(conf, listeners, layerIndex, paramsView, initializeParams, networkDataType, nIn, nOut);
//    }
//
//    @Override
//    public ParamInitializer initializer() {
//        return null;
//    }
//
//    @Override
//    public InputType getOutputType(int layerIndex, InputType inputType) {
//        return InputType.feedForward(nOut); // 输出是 nOut 的向量
//    }
//
//    @Override
//    public void setNIn(InputType inputType, boolean b) {
//
//    }
//
//    @Override
//    public InputPreProcessor getPreProcessorForInputType(InputType inputType) {
//        return null;
//    }
//
//    @Override
//    public List<Regularization> getRegularizationByParam(String s) {
//        return List.of();
//    }
//
//    @Override
//    public boolean isPretrainParam(String s) {
//        return false;
//    }
//
//    @Override
//    public GradientNormalization getGradientNormalization() {
//        return null;
//    }
//
//    @Override
//    public double getGradientNormalizationThreshold() {
//        return 0;
//    }
//
//    @Override
//    public LayerMemoryReport getMemoryReport(InputType inputType) {
//        return null;
//    }
//
//    public static class Builder extends org.deeplearning4j.nn.conf.layers.Layer.Builder<Builder> {
//        private int nIn;
//        private int nOut;
//
//        public Builder nIn(int nIn) {
//            this.nIn = nIn;
//            return this;
//        }
//
//        public Builder nOut(int nOut) {
//            this.nOut = nOut;
//            return this;
//        }
//
//        @Override
//        public AttentionLayer build() {
//            return new AttentionLayer(nIn, nOut);
//        }
//    }
//}
//
//class AttentionLayerInstance extends org.deeplearning4j.nn.layers.AbstractLayer<AttentionLayer> {
//    private int nIn;
//    private int nOut;
//
//    public AttentionLayerInstance(NeuralNetConfiguration conf, Collection<TrainingListener> listeners, int index, INDArray paramsView, boolean initializeParams, DataType dataType, int nIn, int nOut) {
//        super(conf, dataType);
//        this.nIn = nIn;
//        this.nOut = nOut;
//    }
//
//
//    @Override
//    public INDArray activate(boolean training, LayerWorkspaceMgr workspaceMgr) {
//        INDArray input = this.input; // 输入数据
//
//        // 将输入拆分为 Query, Key, Value
//        int headSize = nIn / 3; // 假设输入包含 Query, Key, Value，三部分等分
//        INDArray query = input.getColumns(0, headSize);
//        INDArray key = input.getColumns(headSize, 2 * headSize);
//        INDArray value = input.getColumns(2 * headSize, 3 * headSize);
//
//        // 计算注意力权重
//        INDArray attentionScores = query.mmul(key.transpose()).div(Math.sqrt(headSize)); // Q * K^T / sqrt(d_k)
//
//        // Use Transforms.softmax() for the softmax operation
//        INDArray attentionWeights = Transforms.softmax(attentionScores, true); // Softmax along axis 1
//
//        // 加权求和
//        INDArray output = attentionWeights.mmul(value);
//
//        return output; // 返回加权和
//    }
//
//    @Override
//    public Pair<Gradient, INDArray> backpropGradient(INDArray epsilon, LayerWorkspaceMgr workspaceMgr) {
//        // 假设输入为 Query, Key, Value 的拼接
//        int headSize = nIn / 3;
//        INDArray query = input.getColumns(0, headSize);
//        INDArray key = input.getColumns(headSize, 2 * headSize);
//        INDArray value = input.getColumns(2 * headSize, 3 * headSize);
//
//        // 计算梯度 (示例：反向传播过程，可根据需求具体实现)
//        INDArray dQuery = epsilon.mmul(key); // 损失对 Query 的梯度
//        INDArray dKey = epsilon.mmul(query.transpose()); // 损失对 Key 的梯度
//        INDArray dValue = epsilon; // 损失对 Value 的梯度
//
//        // 合并梯度
//        INDArray dInput = Nd4j.hstack(dQuery, dKey, dValue);
//
//        // 返回梯度和误差
//        Gradient gradient = new DefaultGradient(); // 此处可以根据需要定义参数的梯度
//        return new Pair<>(gradient, dInput);
//    }
//
//
//    @Override
//    public boolean isPretrainLayer() {
//        return false;
//    }
//
//    @Override
//    public void clearNoiseWeightParams() {
//
//    }
//}
