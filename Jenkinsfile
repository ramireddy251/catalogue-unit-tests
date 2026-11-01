
pipeline {
    agent {
        node {
            label 'Roboshop'
        }
    }

    environment {
        APP_VERSION = ''
        IMAGE_NAME = ''

        AWS_ACCOUNT_ID = '104050870679'
        AWS_REGION = 'us-east-1'
        ECR_REPO_NAME = 'roboshop/catalogue'
        ECR_REGISTRY = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    }

    options {
        timeout(time: 60, unit: 'MINUTES')
        timestamps()
    }

    stages {

        stage('Read Version') {
            steps {
                script {
                    def version = sh(
                        script: "node -p \"require('./package.json').version || ''\"",
                        returnStdout: true
                    ).trim()

                    if (!version || version == 'undefined' || version == 'null') {
                        error 'Unable to read application version from package.json'
                    }

                    env.APP_VERSION = version
                    env.IMAGE_NAME = "${env.ECR_REGISTRY}/${env.ECR_REPO_NAME}:${env.APP_VERSION}"

                    echo "Building version: ${env.APP_VERSION}"
                    echo "Docker image: ${env.IMAGE_NAME}"
                }
            }
        }

        stage('Install Dependencies') {
            steps {
                sh 'npm install'
            }
        }

        stage('Unit Tests') {
            steps {
                sh 'npm test'
            }
        }

        stage('SonarQube Analysis') {
            steps {
                script {
                    def scannerHome = tool name: 'sonar-8'

                    withSonarQubeEnv('sonar-server') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner \
                              -Dsonar.exclusions=**/node_modules/**,**/coverage/**,**/trivy-report.html,**/trivy-os-report.html,**/trivy-reports/**,**/reports/**
                        """
                    }
                }
            }
        }

        stage('Quality Gate') {
            steps {
                timeout(time: 1, unit: 'HOURS') {
                    waitForQualityGate abortPipeline: true
                }
            }
        }

        stage('Dependabot Alerts Check') {
            steps {
                withCredentials([
                    string(
                        credentialsId: 'github-token',
                        variable: 'GITHUB_TOKEN'
                    )
                ]) {
                    script {
                        def owner = 'ramireddy251'
                        def repo = 'catalogue-unit-tests'

                        def response = sh(
                            script: '''
                                curl -s -w "\\n%{http_code}" \
                                  -H "Authorization: Bearer $GITHUB_TOKEN" \
                                  -H "Accept: application/vnd.github+json" \
                                  -H "X-GitHub-Api-Version: 2022-11-28" \
                                  "https://api.github.com/repos/ramireddy251/catalogue-unit-tests/dependabot/alerts?severity=high,critical&state=open&per_page=100"
                            ''',
                            returnStdout: true
                        ).trim()

                        def parts = response.tokenize('\n')
                        def httpStatus = parts[-1].trim()
                        def body = parts.size() > 1 ?
                            parts[0..-2].join('\n') : ''

                        if (httpStatus != '200') {
                            error "GitHub API failed with HTTP ${httpStatus}. Check token permissions. Response: ${body}"
                        }

                        def alerts = readJSON text: body

                        if (alerts.size() == 0) {
                            echo 'No HIGH or CRITICAL Dependabot alerts found.'
                        } else {
                            echo "Found ${alerts.size()} HIGH/CRITICAL Dependabot alert(s):"

                            alerts.each { alert ->
                                def pkg = alert.security_vulnerability?.package?.name ?: 'unknown'
                                def severity = alert.security_advisory?.severity?.toUpperCase() ?: 'UNKNOWN'
                                def summary = alert.security_advisory?.summary ?: 'No summary'
                                def fixedIn = alert.security_vulnerability?.first_patched_version?.identifier ?: 'No fix available'

                                echo "[${severity}] ${pkg} - ${summary} (Fixed in: ${fixedIn})"
                            }

                            error "Pipeline failed: ${alerts.size()} HIGH/CRITICAL Dependabot alert(s) detected."
                        }
                    }
                }
            }
        }

        stage('Build Docker Image') {
            steps {
                sh '''
                    echo "Building Docker image: $IMAGE_NAME"
                    docker build --no-cache -t "$IMAGE_NAME" .
                '''
            }
        }

        stage('Trivy OS Scan') {
            steps {
                script {
                    sh '''
                        curl -sfL \
                          https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/html.tpl \
                          -o html.tpl

                        test -s html.tpl
                    '''

                    // Generate text report
                    sh '''
                        trivy image \
                          --scanners vuln \
                          --pkg-types os \
                          --severity HIGH,MEDIUM \
                          --format table \
                          --output trivy-os-report.txt \
                          --exit-code 0 \
                          "$IMAGE_NAME"
                    '''

                    // Generate HTML report
                    sh '''
                        trivy image \
                          --scanners vuln \
                          --pkg-types os \
                          --severity HIGH,MEDIUM \
                          --format template \
                          --template "@html.tpl" \
                          --output trivy-os-report.html \
                          --exit-code 0 \
                          "$IMAGE_NAME"
                    '''

                    sh 'cat trivy-os-report.txt'

                    publishHTML(target: [
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: '.',
                        reportFiles: 'trivy-os-report.html',
                        reportName: 'Trivy OS Vulnerability Report'
                    ])

                    // Fail if HIGH or MEDIUM OS vulnerabilities exist
                    def scanResult = sh(
                        script: '''
                            trivy image \
                              --scanners vuln \
                              --pkg-types os \
                              --severity HIGH,MEDIUM \
                              --exit-code 1 \
                              --quiet \
                              "$IMAGE_NAME"
                        ''',
                        returnStatus: true
                    )

                    if (scanResult != 0) {
                        error 'Trivy found HIGH/MEDIUM OS vulnerabilities. Check the Trivy OS Vulnerability Report.'
                    } else {
                        echo 'No HIGH or MEDIUM OS vulnerabilities found.'
                    }
                }
            }
        }

        stage('Push to ECR') {
            steps {
                sh '''
                    echo "Logging in to AWS ECR..."

                    aws ecr get-login-password --region "$AWS_REGION" |
                      docker login \
                        --username AWS \
                        --password-stdin "$ECR_REGISTRY"

                    echo "Pushing image: $IMAGE_NAME"
                    docker push "$IMAGE_NAME"
                '''
            }
        }
    }

    post {
        always {
            echo 'Pipeline execution completed.'
        }

        success {
            echo 'Pipeline SUCCESS.'
        }

        failure {
            echo 'Pipeline FAILURE. Please check the stage logs.'
        }
    }
}
