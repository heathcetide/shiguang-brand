// TODO ml - module
//package com.foodrecord.ml.model.layer;
//import org.deeplearning4j.nn.api.ParamInitializer;
//import org.deeplearning4j.nn.conf.GradientNormalization;
//import org.deeplearning4j.nn.conf.InputPreProcessor;
//import org.deeplearning4j.nn.conf.NeuralNetConfiguration;
//import org.deeplearning4j.nn.conf.inputs.InputType;
//import org.deeplearning4j.nn.conf.memory.LayerMemoryReport;
//import org.deeplearning4j.nn.gradient.Gradient;
//import org.deeplearning4j.nn.workspace.LayerWorkspaceMgr;
//import org.deeplearning4j.optimize.api.TrainingListener;
//import org.nd4j.common.primitives.Pair;
//import org.nd4j.linalg.api.buffer.DataType;
//import org.nd4j.linalg.api.ndarray.INDArray;
//import org.nd4j.linalg.learning.regularization.Regularization;
//
//import java.util.Collection;
//import java.util.List;
//
//public class ResidualLayer extends org.deeplearning4j.nn.conf.layers.Layer {
//    private int nIn;
//    private int nOut;
//
//    public ResidualLayer(int nIn, int nOut) {
//        this.nIn = nIn;
//        this.nOut = nOut;
//    }
//
//    @Override
//    public org.deeplearning4j.nn.api.Layer instantiate(NeuralNetConfiguration conf, Collection<TrainingListener> listeners, int layerIndex, INDArray paramsView, boolean initializeParams, DataType networkDataType) {
//        // 使用基础实现类来封装 ResidualLayer 的计算逻辑
//        return new ResidualLayerInstance(conf, listeners, layerIndex, paramsView, initializeParams, networkDataType, nIn, nOut);
//    }
//
//    @Override
//    public ParamInitializer initializer() {
//        // 残差层不需要特殊参数初始化
//        return null;
//    }
//
//    @Override
//    public InputType getOutputType(int layerIndex, InputType inputType) {
//        // 输出形状等同于输入形状
//        return inputType;
//    }
//
//    @Override
//    public void setNIn(InputType inputType, boolean override) {
//        // 检查输入类型，确保兼容性
//    }
//
//    @Override
//    public InputPreProcessor getPreProcessorForInputType(InputType inputType) {
//        // 默认不需要预处理
//        return null;
//    }
//
//    @Override
//    public List<Regularization> getRegularizationByParam(String paramName) {
//        return null;
//    }
//
//    @Override
//    public boolean isPretrainParam(String paramName) {
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
//        // 返回层的内存使用报告
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
//        public ResidualLayer build() {
//            return new ResidualLayer(nIn, nOut);
//        }
//    }
//}
//
//// 实例化类，用于实际执行计算
//class ResidualLayerInstance extends org.deeplearning4j.nn.layers.AbstractLayer<ResidualLayer> {
//
//    private int nIn;
//    private int nOut;
//
//    public ResidualLayerInstance(NeuralNetConfiguration conf, Collection<TrainingListener> listeners, int index, INDArray paramsView, boolean initializeParams, DataType dataType, int nIn, int nOut) {
//        super(conf, dataType);
//        this.nIn = nIn;
//        this.nOut = nOut;
//    }
//
//    @Override
//    public Pair<Gradient, INDArray> backpropGradient(INDArray indArray, LayerWorkspaceMgr layerWorkspaceMgr) {
//        return null;
//    }
//
//    @Override
//    public INDArray activate(boolean training, LayerWorkspaceMgr workspaceMgr) {
//        INDArray input = this.input;
//        // 残差计算：输出 = 输入 + 模型的主干计算
//        INDArray output = input.add(input); // 示例中直接返回输入，实际可扩展为复杂逻辑
//        return output;
//    }
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
