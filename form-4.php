<?php
use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;
use PHPMailer\PHPMailer\SMTP;

// Include PHPMailer library
require 'PHPMailer\src\Exception.php';
require 'PHPMailer\src\PHPMailer.php';
require 'PHPMailer\src\SMTP.php';

// Check if the form is submitted
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Get form data
    $name = $_POST['name']; 
    $contact = $_POST['contact'];
    $email = $_POST['email']; 
    $profile = $_POST['profile'];
    $state = $_POST['state'];
    $address = $_POST['address'];

    // Create a new PHPMailer instance
    $mail = new PHPMailer(true);

    try {
        // Set SMTP configuration
        $mail->isSMTP();
        $mail->Host = 'smtp-relay.brevo.com'; // Replace with your SMTP server address
        $mail->SMTPAuth = true;
        $mail->Username = getenv('SMTP_USERNAME');
        $mail->Password = getenv('SMTP_PASSWORD');
        $mail->SMTPSecure = 'tls'; // Options: 'ssl' (deprecated) or 'tls'
        $mail->Port = 587; // TCP port to connect to, use 465 for 'ssl'

        // Set email content and recipient
        $mail->setFrom($email); // Set sender's email and name
        $mail->addAddress('info@agross.in'); // Add recipient email and name

        $mail->isHTML(true);
        $mail->Subject = 'Join Us Request';
        $mail->Body = "
            <h3>Join Us Request</h3>
            <p><strong>Name:</strong> $name</p>
            <p><strong>Contact No:</strong> $contact</p>
            <p><strong>Mail id:</strong> $email</p>
            <p><strong>Profile:</strong> $profile</p>
            <p><strong>State:</strong> $state</p>
            <p><strong>Address:</strong> $address</p>
        ";

        $mail->send();
        header('Location:  https://agross.in/thankyou.html');
        exit;

    } catch (Exception $e) {
        echo "Email could not be sent. Error: {$mail->ErrorInfo}";
    }
}
?>