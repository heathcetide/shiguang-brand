pipeline {
    agent any

    environment {
        DOCKER_REGISTRY = 'registry.example.com'
        APP_NAME = 'food-record'
    }

    stages {
        stage('Unit Tests') {
            steps {
                sh './gradlew test'
                junit '**/build/test-results/test/*.xml'
                jacoco(
                    execPattern: '**/build/jacoco/*.exec',
                    classPattern: '**/build/classes/java/main',
                    sourcePattern: '**/src/main/java'
                )
            }
        }

        stage('Integration Tests') {
            steps {
                sh './gradlew integrationTest'
                junit '**/build/test-results/integrationTest/*.xml'
            }
        }

        stage('Performance Tests') {
            when { branch 'master' }
            steps {
                sh '''
                    ./gradlew jmh
                    ./gradlew gatlingRun
                '''
                gatlingArchive()
            }
            post {
                always {
                    perfReport(
                        sourceDataFiles: '**/build/reports/gatling/**/*.log',
                        errorFailedThreshold: 5,
                        errorUnstableThreshold: 3
                    )
                }
            }
        }

        stage('Security Tests') {
            steps {
                dependencyCheck(
                    additionalArguments: '--format HTML --format XML',
                    odcInstallation: 'OWASP Dependency-Check'
                )

                publishHTML(
                    target: [
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'build/reports/dependency-check-report',
                        reportFiles: 'dependency-check-report.html',
                        reportName: 'Dependency Check Report'
                    ]
                )
            }
        }
    }

    post {
        always {
            // 清理测试环境
            sh './gradlew cleanTestContainers'

            // 发送测试报告
            emailext(
                subject: "Pipeline ${currentBuild.result}: ${env.JOB_NAME}",
                body: '''${SCRIPT, template="groovy-html.template"}''',
                recipientProviders: [[$class: 'DevelopersRecipientProvider']]
            )
        }
    }
}